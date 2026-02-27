import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  COLLECTIONS,
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
  createEventScheduleRow,
  createScheduleEntry,
  deleteEvent,
  deleteEventScheduleRow,
  deleteOpenPacket,
  deleteSchool,
  deleteScheduleEntry,
  loadAdminDutiesEntriesForEvent,
  getPacketData,
  loadAdminDutiesEntriesForSchool,
  renameEvent,
  lockSubmission,
  lockOpenPacket,
  linkOpenPacketToEnsemble,
  setOpenPacketJudgePosition,
  provisionUser,
  releasePacket,
  releaseOpenPacket,
  saveAssignments,
  saveAdminDutiesForEnsemble,
  saveSchool,
  setActiveEvent,
  publishEventSchedule,
  unreleasePacket,
  unpublishEventSchedule,
  unlockOpenPacket,
  unlockSubmission,
  unreleaseOpenPacket,
  updateEventScheduleRow,
  updateScheduleEntryTime,
  watchEventScheduleRows,
  watchPublishedEventScheduleRows,
  watchOpenPacketsAdmin,
  watchAssignmentsForActiveEvent,
  watchActiveEvent,
  watchEvents,
  watchJudges,
  watchRoster,
  watchSchools,
  watchEntryStatus,
  watchScheduleEnsembles,
} from "./admin.js";
import {
  attachDirectorSchool,
  createDirectorEnsemble,
  computeDirectorCompletionState,
  discardDirectorDraftChanges,
  detachDirectorSchool,
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
  getOpenCaptionTemplate,
  isOpenPacketEditable,
  loadDirectorEntrySnapshotForJudge,
  loadOpenPrefs,
  markJudgeOpenDirty,
  resetJudgeOpenState,
  retryOpenSessionUploads,
  selectOpenPacket,
  saveOpenPrefs,
  saveOpenPrefsToServer,
  startOpenRecording,
  stopOpenRecording,
  submitOpenPacket,
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
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, serverTimestamp } from "./firestore.js";
import {
  formatPerformanceAt,
  formatDateHeading,
  getEventCardLabel,
  getEventLabel,
  getSchoolNameById,
  derivePerformanceGrade,
  levelToRoman,
  romanToLevel,
} from "./utils.js";

export function alertUser(message) {
  window.alert(message);
}

export function confirmUser(message) {
  return window.confirm(message);
}

function getEffectiveRole(profile) {
  if (!profile) return null;
  if (profile.role) return profile.role;
  if (profile.roles?.judge) return "judge";
  if (profile.roles?.admin) return "admin";
  if (profile.roles?.director) return "director";
  return null;
}


function canUseOpenJudge(profile) {
  const role = getEffectiveRole(profile);
  return role === "judge" || role === "admin";
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
  return state.judgeOpen.useActiveEventDefaults !== false;
}

function syncOpenEventDefaultsUI() {
  if (els.judgeOpenUseEventDefaultsToggle) {
    els.judgeOpenUseEventDefaultsToggle.checked = getOpenEventDefaultsPreference();
  }
  if (!els.judgeOpenEventDefaultsStatus) return;
  const assignment = state.judgeOpen.activeEventAssignment;
  if (!getOpenEventDefaultsPreference()) {
    els.judgeOpenEventDefaultsStatus.textContent = "Open mode: event defaults are turned off.";
    return;
  }
  const activeEventName = state.event.active?.name || "";
  if (activeEventName && !assignment) {
    els.judgeOpenEventDefaultsStatus.textContent =
      `Active event detected (${activeEventName}), but no judge assignment was found for your account. Working in open mode.`;
    return;
  }
  if (!assignment) {
    els.judgeOpenEventDefaultsStatus.textContent = "Open mode: no active event is set.";
    return;
  }
  const eventName = activeEventName || "Active event";
  const label = JUDGE_POSITION_LABELS[assignment.judgePosition] || assignment.judgePosition;
  els.judgeOpenEventDefaultsStatus.textContent = `Using active event defaults: ${label} for ${eventName}.`;
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
}

function startActiveAssignmentsWatcher() {
  watchAssignmentsForActiveEvent((assignments) => {
    setStageJudgeSelectValues(assignments || {});
    renderAdminReadiness();
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
  els.lunchTotalCost.textContent = `Total: $${total.toFixed(2)}`;
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
    setDirectorEntryStatusLabel(status || "Incomplete");
  setDirectorPerformanceGradeValue(performanceGrade || entry?.performanceGrade || "");
  setPerformanceGradeError("");
  renderDirectorChecklist(entry, completionState);
  updateDirectorReadyControlsFromState(completionState);
  renderDirectorAdminDutiesSummary(entry || null);
  if (updatedAt) {
    setDirectorEntryHint(`Last updated ${updatedAt.toLocaleString()}`);
  } else {
    setDirectorEntryHint("");
  }
  refreshDirectorSchoolLunchTotal();
}

function applyDirectorEntryClear({ hint, status, readyStatus } = {}) {
  clearDirectorEntryPanels();
  setDirectorEntryHint(hint || "");
    setDirectorEntryStatusLabel(status || "Incomplete");
  setDirectorReadyControls({ status: readyStatus || "disabled" });
  setDirectorPerformanceGradeValue("");
  setPerformanceGradeError("");
  renderDirectorChecklist(null, computeDirectorCompletionState(null));
  renderDirectorAdminDutiesSummary(null);
  invalidateDirectorSchoolLunchTotalCache({
    eventId: state.director.selectedEventId || state.event.active?.id || null,
    schoolId: getDirectorSchoolId() || null,
  });
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
      `Total for Lunch: $${total.toFixed(2)} - check payable to Ashley High School Band Boosters`
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
    if (director.email) {
      const email = document.createElement("div");
      email.className = "director-school-director-email";
      email.textContent = director.email;
      row.appendChild(email);
    }
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
  } else {
    const original = button.dataset.originalLabel;
    button.textContent = original || button.textContent;
    button.disabled = false;
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
  if (buttonElement.dataset.spinner === "true") {
    ensureButtonSpinner(buttonElement);
    buttonElement.classList.add("is-loading");
  }
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
}

export function refreshSchoolDropdowns() {
  const logisticsCurrentSchoolValue = els.adminLogisticsCurrentSchoolSelect?.value || "";
  const logisticsNextSchoolValue = els.adminLogisticsNextSchoolSelect?.value || "";
  const dutiesSchoolValue = els.adminDutiesSchoolSelect?.value || "";
  const eventScheduleSchoolValue = els.eventScheduleAddSchoolSelect?.value || "";
  renderSchoolOptions(els.directorSchoolSelect, "Select a school");
  renderSchoolOptions(els.directorAttachSelect, "Select a school");
  renderSchoolOptions(els.provisionSchoolSelect, "Select a school (optional)");
  renderSchoolOptions(els.scheduleSchoolSelect, "Select a school");
  renderSchoolOptions(els.adminLogisticsCurrentSchoolSelect, "Select a school");
  renderSchoolOptions(els.adminLogisticsNextSchoolSelect, "Select a school");
  renderSchoolOptions(els.adminDutiesSchoolSelect, "Select a school");
  renderSchoolOptions(els.eventScheduleAddSchoolSelect, "Select a school");
  if (els.adminLogisticsCurrentSchoolSelect) {
    const exists = state.admin.schoolsList.some((school) => school.id === logisticsCurrentSchoolValue);
    els.adminLogisticsCurrentSchoolSelect.value = exists ? logisticsCurrentSchoolValue : "";
  }
  if (els.adminLogisticsNextSchoolSelect) {
    const exists = state.admin.schoolsList.some((school) => school.id === logisticsNextSchoolValue);
    els.adminLogisticsNextSchoolSelect.value = exists ? logisticsNextSchoolValue : "";
  }
  if (els.adminDutiesSchoolSelect) {
    const exists = state.admin.schoolsList.some((school) => school.id === dutiesSchoolValue);
    els.adminDutiesSchoolSelect.value = exists ? dutiesSchoolValue : "";
  }
  if (els.eventScheduleAddSchoolSelect) {
    const exists = state.admin.schoolsList.some((school) => school.id === eventScheduleSchoolValue);
    els.eventScheduleAddSchoolSelect.value = exists ? eventScheduleSchoolValue : "";
  }
}

export function openAuthModal() {
  if (!els.authModal) return;
  state.app.lastFocusedElement = document.activeElement;
  els.authModal.classList.add("is-open");
  els.authModal.setAttribute("aria-hidden", "false");
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
  window.setTimeout(() => {
    const target =
      els.emailInput ||
      els.authModal.querySelector("input, button, select, textarea, a[href]");
    if (target) target.focus();
  }, 0);
  if (!state.app.authModalKeyHandler) {
    state.app.authModalKeyHandler = (event) => {
      if (!els.authModal || !els.authModal.classList.contains("is-open")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeAuthModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        els.authModal.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
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
    document.addEventListener("keydown", state.app.authModalKeyHandler);
  }
}

export function closeAuthModal() {
  if (!els.authModal) return;
  els.authModal.classList.remove("is-open");
  els.authModal.setAttribute("aria-hidden", "true");
  if (state.auth.currentUser && els.headerAuthButtons && els.signOutBtn.parentElement !== els.headerAuthButtons) {
    els.headerAuthButtons.appendChild(els.signOutBtn);
    if (els.directorProfileToggleBtn) {
      els.headerAuthButtons.insertBefore(els.directorProfileToggleBtn, els.signOutBtn);
    }
  }
  if (state.app.authModalKeyHandler) {
    document.removeEventListener("keydown", state.app.authModalKeyHandler);
    state.app.authModalKeyHandler = null;
  }
  if (state.app.lastFocusedElement && state.app.lastFocusedElement.focus) {
    state.app.lastFocusedElement.focus();
    state.app.lastFocusedElement = null;
  }
}

export function showSessionExpiredModal() {
  if (!els.sessionExpiredModal) return;
  els.sessionExpiredModal.classList.add("is-open");
  els.sessionExpiredModal.setAttribute("aria-hidden", "false");
}

export function hideSessionExpiredModal() {
  if (!els.sessionExpiredModal) return;
  els.sessionExpiredModal.classList.remove("is-open");
  els.sessionExpiredModal.setAttribute("aria-hidden", "true");
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
  els.directorProfileModal.classList.add("is-open");
  els.directorProfileModal.setAttribute("aria-hidden", "false");
}

export function closeDirectorProfileModal() {
  if (!els.directorProfileModal) return;
  els.directorProfileModal.classList.remove("is-open");
  els.directorProfileModal.setAttribute("aria-hidden", "true");
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
  els.userProfileModal.classList.add("is-open");
  els.userProfileModal.setAttribute("aria-hidden", "false");
}

export function closeUserProfileModal() {
  if (!els.userProfileModal) return;
  els.userProfileModal.classList.remove("is-open");
  els.userProfileModal.setAttribute("aria-hidden", "true");
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

let authHandlersBound = false;

export function bindAuthHandlers() {
  if (authHandlersBound) return;
  authHandlersBound = true;

  if (els.signInBtn) {
    els.signInBtn.addEventListener("click", () => {
      openAuthModal();
      setAuthView("signIn");
    });
  }
  if (els.authModalBackdrop) {
    els.authModalBackdrop.addEventListener("click", closeAuthModal);
  }
  if (els.authModalClose) {
    els.authModalClose.addEventListener("click", closeAuthModal);
  }

  if (els.emailForm) {
    els.emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setRoleHint("");
      try {
        setAuthFormDisabled(true);
        if (els.emailSignInBtn) {
          setSavingState(els.emailSignInBtn, true, "Signing in...");
        }
        await signIn(els.emailInput?.value, els.passwordInput?.value);
      } catch (error) {
        console.error("Email sign-in failed", error);
        setRoleHint("Sign-in failed. Check email/password or reset your password.");
      } finally {
        if (els.emailSignInBtn) {
          setSavingState(els.emailSignInBtn, false);
        }
        setAuthFormDisabled(false);
      }
    });
  }

  if (els.anonymousBtn) {
    if (!DEV_FLAGS.allowAnonymousSignIn) {
      els.anonymousBtn.style.display = "none";
    } else {
      els.anonymousBtn.addEventListener("click", async () => {
        try {
          await signIn("", "", { anonymous: true });
        } catch (error) {
          console.error("Anonymous sign-in failed", error);
          setRoleHint("Anonymous sign-in failed.");
        }
      });
    }
  }

  if (els.forgotPasswordBtn) {
    els.forgotPasswordBtn.addEventListener("click", async () => {
      const email = els.emailInput?.value.trim() || "";
      if (!email) {
        setRoleHint("Enter your email to request a password reset.");
        return;
      }
      try {
        await requestPasswordReset(email);
        setRoleHint("Password reset email sent.");
      } catch (error) {
        console.error("Password reset failed", error);
        setRoleHint("Password reset failed. Confirm the email and try again.");
      }
    });
  }

  if (els.showDirectorSignupBtn) {
    els.showDirectorSignupBtn.addEventListener("click", () => {
      setAuthView("director");
    });
  }

  if (els.backToSignInBtn) {
    els.backToSignInBtn.addEventListener("click", () => {
      setAuthView("signIn");
    });
  }

  if (els.directorSignupBtn) {
    els.directorSignupBtn.addEventListener("click", async () => {
      const email = els.directorEmailInput?.value.trim() || "";
      const password = els.directorPasswordInput?.value.trim() || "";
      const schoolId = els.directorSchoolSelect?.value || null;
      if (!email || !password) {
        setRoleHint("Provide email and password to create a director account.");
        return;
      }
      if (!schoolId) {
        setRoleHint("Select your school to complete director signup.");
        return;
      }
      const schoolValid = state.admin.schoolsList.some((school) => school.id === schoolId);
      if (!schoolValid) {
        setRoleHint("Selected school not found. Refresh and try again.");
        return;
      }
      try {
        await createDirectorAccount({ email, password, schoolId });
        setRoleHint("Director account created.");
        if (els.directorEmailInput) els.directorEmailInput.value = "";
        if (els.directorPasswordInput) els.directorPasswordInput.value = "";
        if (els.directorSchoolSelect) els.directorSchoolSelect.value = "";
        setAuthView("signIn");
        closeAuthModal();
        setAuthSuccess("Director account created. Please sign in.");
      } catch (error) {
        console.error("Director signup failed", error);
        const code = error?.code || "";
        if (code.includes("auth/email-already-in-use")) {
          setRoleHint("That email is already in use. Try signing in instead.");
        } else if (code.includes("auth/weak-password")) {
          setRoleHint("Password is too weak. Use at least 6 characters.");
        } else if (code.includes("auth/invalid-email")) {
          setRoleHint("Email address is invalid.");
        } else {
          setRoleHint("Director signup failed. Check inputs or try again.");
        }
      }
    });
  }

  if (els.signOutBtn) {
    els.signOutBtn.addEventListener("click", async () => {
      await signOut();
    });
  }
}

export function updateDirectorAttachUI() {
  const isDirector = isDirectorManager();
  const isDirectorOnly = state.auth.userProfile?.role === "director";
  const hasSchool = Boolean(getDirectorSchoolId());
  if (els.directorAttachGate) {
    els.directorAttachGate.style.display =
      isDirector && !hasSchool ? "block" : "none";
  }
  if (els.directorAttachControls) {
    els.directorAttachControls.style.display =
      isDirector && !hasSchool ? "flex" : "none";
  }
  if (els.directorDetachControls) {
    els.directorDetachControls.style.display =
      isDirector && hasSchool ? "flex" : "none";
  }
  if (els.directorSummaryAttachedContent) {
    els.directorSummaryAttachedContent.style.display =
      isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorSchoolDirectors) {
    if (!hasSchool) {
      els.directorSchoolDirectors.style.display = "none";
      els.directorSchoolDirectors.innerHTML = "";
    }
  }
  if (els.directorEnsemblesSection) {
    els.directorEnsemblesSection.style.display =
      isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorEnsembleList) {
    els.directorEnsembleList.style.display =
      isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorShowEnsembleFormBtn) {
    els.directorShowEnsembleFormBtn.style.display =
      isDirector && hasSchool ? "inline-flex" : "none";
  }
  if (els.directorMainStack) {
    els.directorMainStack.style.display =
      isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorEnsembleForm) {
    state.director.editingEnsembleId = null;
    els.directorEnsembleForm.classList.add("is-hidden");
  }
  if (els.directorEnsembleSubmitBtn) {
    els.directorEnsembleSubmitBtn.textContent = "Create Ensemble";
  }
  if (els.directorEnsembleError) {
    els.directorEnsembleError.textContent = "";
  }
  if (els.directorProfilePanel) {
    els.directorProfilePanel.style.display = "none";
  }
  if (els.directorProfileToggleBtn) {
    els.directorProfileToggleBtn.style.display = isDirectorOnly ? "inline-flex" : "none";
  }
  if (els.directorEventSelect) {
    els.directorEventSelect.disabled = !(isDirector && hasSchool);
  }
  if (els.directorEntryPanel) {
    els.directorEntryPanel.style.display = isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorPackets) {
    els.directorPackets.style.display = isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorEmpty) {
    els.directorEmpty.style.display = isDirector && hasSchool ? "block" : "none";
  }
}

export function confirmDiscardUnsaved() {
  if (!hasUnsavedChanges()) return true;
  return confirmUser("You have unsaved changes. Leave anyway?");
}

function updateTabUI(tabName, role) {
  if (!role) {
    if (els.adminCard) {
      els.adminCard.hidden = true;
      els.adminCard.style.display = "none";
    }
    if (els.judgeCard) {
      els.judgeCard.hidden = true;
      els.judgeCard.style.display = "none";
    }
    if (els.directorCard) {
      els.directorCard.hidden = true;
      els.directorCard.style.display = "none";
    }
    return;
  }
  els.tabButtons.forEach((button) => {
    const allowed = isTabAllowed(button.dataset.tab, role);
    const isSelected = button.dataset.tab === tabName;
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
    button.disabled = !allowed;
    button.hidden = role === "admin" ? false : !allowed;
    button.tabIndex = isSelected ? 0 : -1;
  });
  const showAdmin = tabName === "admin";
  const showJudge = tabName === "judge";
  const showJudgeOpen = tabName === "judge-open";
  const showDirector = tabName === "director";
  if (els.adminCard) {
    els.adminCard.hidden = !showAdmin;
    els.adminCard.style.display = showAdmin ? "grid" : "none";
  }
  if (els.judgeCard) {
    els.judgeCard.hidden = !showJudge;
    els.judgeCard.style.display = showJudge ? "grid" : "none";
  }
  if (els.judgeOpenCard) {
    els.judgeOpenCard.hidden = !showJudgeOpen;
    els.judgeOpenCard.style.display = showJudgeOpen ? "grid" : "none";
  }
  if (els.directorCard) {
    els.directorCard.hidden = !showDirector;
    els.directorCard.style.display = showDirector ? "grid" : "none";
  }
  if (showJudgeOpen) {
    refreshOpenEventDefaultsState();
    updateOpenEmptyState();
    updateOpenSubmitState();
    if (!els.judgeOpenCaptionForm?.children?.length) {
      renderOpenCaptionForm();
    }
  }
  if (els.eventDetailPage && !els.eventDetailPage.classList.contains("is-hidden")) {
    hideEventDetail();
  }
}

export function setTab(tabName, { force } = {}) {
  if (state.app.currentTab === "director" && tabName !== "director") {
    if (!confirmDiscardUnsaved()) return { changed: false, reason: "unsaved" };
  }
  const result = setTabState(tabName, { force });
  if (!result.changed) return result;
  updateTabUI(result.tabName, result.role);
  return result;
}

function renderEventScheduleDetail(event) {
  const eventId = event?.id || els.eventDetailPage?.dataset?.eventId || "";
  const isAdmin = getEffectiveRole(state.auth.userProfile) === "admin";
  const pdfUrl = event?.schedulePdfUrl || "";
  const pdfName = event?.schedulePdfName || "Schedule PDF";
  const publishedVersion = Number(event?.schedulePublishedVersion || 0);
  const publishedAtDate = event?.schedulePublishedAt?.toDate?.() || null;

  if (els.eventScheduleBuilderPanel) {
    els.eventScheduleBuilderPanel.style.display = isAdmin ? "block" : "none";
  }
  if (els.eventSchedulePublishBtn) {
    els.eventSchedulePublishBtn.style.display = isAdmin ? "inline-flex" : "none";
    els.eventSchedulePublishBtn.disabled = !eventId;
  }
  if (els.eventScheduleUnpublishBtn) {
    els.eventScheduleUnpublishBtn.style.display = isAdmin ? "inline-flex" : "none";
    els.eventScheduleUnpublishBtn.disabled = !eventId || !Boolean(event?.schedulePublished);
  }
  if (els.eventSchedulePublishedMeta) {
    els.eventSchedulePublishedMeta.textContent = event?.schedulePublished
      ? `Published${publishedVersion ? ` v${publishedVersion}` : ""}${
          publishedAtDate ? ` • ${publishedAtDate.toLocaleString()}` : ""
        }`
      : "Not published";
  }
  renderEventScheduleAddRowControls(isAdmin);
  renderEventScheduleDraftRows(eventId, isAdmin);
  renderEventSchedulePublishedRows(event);

  if (els.eventScheduleAdminControls) {
    els.eventScheduleAdminControls.style.display = isAdmin ? "flex" : "none";
  }
  if (els.eventScheduleStatus) {
    els.eventScheduleStatus.textContent = "";
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

function stopEventDetailScheduleWatchers() {
  if (state.subscriptions.eventDetailScheduleDraft) {
    state.subscriptions.eventDetailScheduleDraft();
    state.subscriptions.eventDetailScheduleDraft = null;
  }
  if (state.subscriptions.eventDetailSchedulePublished) {
    state.subscriptions.eventDetailSchedulePublished();
    state.subscriptions.eventDetailSchedulePublished = null;
  }
}

function parseLocalDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toLocalDateTimeInput(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatScheduleCellTime(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function renderEventScheduleAddEnsembleOptions(ensembles = []) {
  if (!els.eventScheduleAddEnsembleSelect) return;
  const previous = els.eventScheduleAddEnsembleSelect.value || "";
  els.eventScheduleAddEnsembleSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = ensembles.length ? "Select ensemble" : "No ensembles";
  els.eventScheduleAddEnsembleSelect.appendChild(placeholder);
  ensembles.forEach((ensemble) => {
    const option = document.createElement("option");
    option.value = ensemble.id;
    option.textContent = ensemble.name || ensemble.id;
    option.dataset.ensembleName = ensemble.name || ensemble.id;
    els.eventScheduleAddEnsembleSelect.appendChild(option);
  });
  if (previous && ensembles.some((ensemble) => ensemble.id === previous)) {
    els.eventScheduleAddEnsembleSelect.value = previous;
  }
}

async function refreshEventScheduleAddEnsembles() {
  const schoolId = els.eventScheduleAddSchoolSelect?.value || "";
  if (!schoolId) {
    state.admin.eventDetailScheduleAddEnsembles = [];
    renderEventScheduleAddEnsembleOptions([]);
    return;
  }
  try {
    const ensembles = await fetchAdminLogisticsEnsembles(schoolId);
    if ((els.eventScheduleAddSchoolSelect?.value || "") !== schoolId) return;
    state.admin.eventDetailScheduleAddEnsembles = ensembles;
    renderEventScheduleAddEnsembleOptions(ensembles);
  } catch (error) {
    console.error("refreshEventScheduleAddEnsembles failed", error);
    state.admin.eventDetailScheduleAddEnsembles = [];
    renderEventScheduleAddEnsembleOptions([]);
  }
}

function renderEventScheduleAddRowControls(isAdmin) {
  if (!els.eventScheduleAddSchoolSelect) return;
  const wrapControls = [
    els.eventScheduleAddSchoolSelect,
    els.eventScheduleAddEnsembleSelect,
    els.eventScheduleAddOrderInput,
    els.eventScheduleAddHoldingInput,
    els.eventScheduleAddWarmupInput,
    els.eventScheduleAddPerformanceInput,
    els.eventScheduleAddSightInput,
    els.eventScheduleAddRowBtn,
  ].filter(Boolean);
  wrapControls.forEach((el) => {
    el.disabled = !isAdmin;
  });
  if (!isAdmin) {
    return;
  }
  renderSchoolOptions(els.eventScheduleAddSchoolSelect, "Select a school");
  const currentSchoolId = els.eventScheduleAddSchoolSelect.value || "";
  if (!currentSchoolId && state.admin.schoolsList.length) {
    els.eventScheduleAddSchoolSelect.value = state.admin.schoolsList[0].id || "";
  }
  refreshEventScheduleAddEnsembles();
}

function renderEventScheduleDraftRows(eventId, isAdmin) {
  const rows = Array.isArray(state.admin.eventDetailDraftScheduleRows)
    ? state.admin.eventDetailDraftScheduleRows
    : [];
  if (els.eventScheduleDraftEmpty) {
    els.eventScheduleDraftEmpty.style.display = rows.length ? "none" : "block";
  }
  if (els.eventScheduleDraftTableWrap) {
    els.eventScheduleDraftTableWrap.style.display = rows.length ? "block" : "none";
  }
  if (!els.eventScheduleDraftBody) return;
  els.eventScheduleDraftBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const orderTd = document.createElement("td");
    const orderInput = document.createElement("input");
    orderInput.type = "number";
    orderInput.min = "1";
    orderInput.step = "1";
    orderInput.value = String(Number(row.sortOrder || 0) || "");
    orderInput.disabled = !isAdmin;
    orderTd.appendChild(orderInput);

    const schoolTd = document.createElement("td");
    schoolTd.textContent = row.schoolName || row.schoolId || "";
    const ensembleTd = document.createElement("td");
    ensembleTd.textContent = row.ensembleName || row.ensembleId || "";

    const makeTimeCell = (field) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "datetime-local";
      input.value = toLocalDateTimeInput(row[field]);
      input.disabled = !isAdmin;
      td.appendChild(input);
      return { td, input };
    };
    const holding = makeTimeCell("holdingAt");
    const warmup = makeTimeCell("warmupAt");
    const performance = makeTimeCell("performanceAt");
    const sight = makeTimeCell("sightReadingAt");

    const actionsTd = document.createElement("td");
    if (isAdmin) {
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "ghost";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", async () => {
        const holdingAtDate = parseLocalDateTime(holding.input.value);
        const warmupAtDate = parseLocalDateTime(warmup.input.value);
        const performanceAtDate = parseLocalDateTime(performance.input.value);
        const sightReadingAtDate = sight.input.value ? parseLocalDateTime(sight.input.value) : null;
        if (!holdingAtDate || !warmupAtDate || !performanceAtDate) {
          alertUser("Holding, warm-up, and performance times are required.");
          return;
        }
        try {
          await updateEventScheduleRow({
            eventId,
            rowId: row.id,
            sortOrder: Number(orderInput.value || row.sortOrder || 9999),
            holdingAtDate,
            warmupAtDate,
            performanceAtDate,
            sightReadingAtDate,
          });
          if (els.eventScheduleDraftStatus) {
            els.eventScheduleDraftStatus.textContent = "Schedule row saved.";
          }
        } catch (error) {
          console.error("updateEventScheduleRow failed", error);
          alertUser(error?.message || "Unable to save schedule row.");
        }
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!confirmUser(`Delete schedule row for ${row.ensembleName || row.ensembleId || "ensemble"}?`)) {
          return;
        }
        try {
          await deleteEventScheduleRow({ eventId, rowId: row.id });
        } catch (error) {
          console.error("deleteEventScheduleRow failed", error);
          alertUser(error?.message || "Unable to delete schedule row.");
        }
      });
      actionsTd.appendChild(saveBtn);
      actionsTd.appendChild(document.createTextNode(" "));
      actionsTd.appendChild(deleteBtn);
    } else {
      actionsTd.textContent = "—";
    }

    [
      orderTd,
      schoolTd,
      ensembleTd,
      holding.td,
      warmup.td,
      performance.td,
      sight.td,
      actionsTd,
    ].forEach((cell) => tr.appendChild(cell));
    els.eventScheduleDraftBody.appendChild(tr);
  });
}

function renderEventSchedulePublishedRows(event) {
  const rows = Array.isArray(state.admin.eventDetailPublishedScheduleRows)
    ? state.admin.eventDetailPublishedScheduleRows
    : [];
  if (els.eventSchedulePublishedSection) {
    els.eventSchedulePublishedSection.style.display = "block";
  }
  if (els.eventSchedulePublishedEmpty) {
    els.eventSchedulePublishedEmpty.style.display = rows.length ? "none" : "block";
  }
  if (els.eventSchedulePublishedTableWrap) {
    els.eventSchedulePublishedTableWrap.style.display = rows.length ? "block" : "none";
  }
  if (els.eventSchedulePublishedStatus) {
    const publishedAtDate = event?.schedulePublishedAt?.toDate?.() || null;
    els.eventSchedulePublishedStatus.textContent = event?.schedulePublished
      ? `Published${publishedAtDate ? ` • ${publishedAtDate.toLocaleString()}` : ""}`
      : "Not published";
  }
  if (!els.eventSchedulePublishedBody) return;
  els.eventSchedulePublishedBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    [
      String(Number(row.sortOrder || 0) || ""),
      row.schoolName || row.schoolId || "",
      row.ensembleName || row.ensembleId || "",
      formatScheduleCellTime(row.holdingAt),
      formatScheduleCellTime(row.warmupAt),
      formatScheduleCellTime(row.performanceAt),
      formatScheduleCellTime(row.sightReadingAt),
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value || "—";
      tr.appendChild(td);
    });
    els.eventSchedulePublishedBody.appendChild(tr);
  });
}

function startEventDetailScheduleWatchers(eventId) {
  stopEventDetailScheduleWatchers();
  const event = state.event.list.find((item) => item.id === eventId) || null;
  const isAdmin = getEffectiveRole(state.auth.userProfile) === "admin";
  if (isAdmin) {
    state.subscriptions.eventDetailScheduleDraft = watchEventScheduleRows(eventId, (rows) => {
      state.admin.eventDetailDraftScheduleRows = rows || [];
      renderEventScheduleDraftRows(eventId, true);
    });
  } else {
    state.admin.eventDetailDraftScheduleRows = [];
    renderEventScheduleDraftRows(eventId, false);
  }
  state.subscriptions.eventDetailSchedulePublished = watchPublishedEventScheduleRows(eventId, (rows) => {
    state.admin.eventDetailPublishedScheduleRows = rows || [];
    const latestEvent = state.event.list.find((item) => item.id === eventId) || event;
    renderEventSchedulePublishedRows(latestEvent);
  });
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

export function showEventDetail(eventId) {
  if (!els.eventDetailPage) return;
  const event = state.event.list.find((item) => item.id === eventId);
  els.eventDetailPage.dataset.eventId = eventId || "";
  if (els.eventDetailTitle) {
    els.eventDetailTitle.textContent = event?.name || "Event Details";
  }
  if (els.eventDetailMeta) {
    els.eventDetailMeta.textContent = event ? getEventLabel(event) : "Event not found.";
  }
  state.admin.eventDetailDraftScheduleRows = [];
  state.admin.eventDetailPublishedScheduleRows = [];
  startEventDetailScheduleWatchers(eventId);
  renderEventScheduleDetail(event);
  els.eventDetailPage.classList.remove("is-hidden");
  if (els.adminCard) els.adminCard.style.display = "none";
  if (els.judgeCard) els.judgeCard.style.display = "none";
  if (els.directorCard) els.directorCard.style.display = "none";
}

export function hideEventDetail() {
  if (!els.eventDetailPage) return;
  stopEventDetailScheduleWatchers();
  els.eventDetailPage.classList.add("is-hidden");
  if (state.app.currentTab) {
    updateTabUI(state.app.currentTab, state.auth.userProfile?.role || null);
  }
}

export function handleHashChange() {
  const action = resolveHash(window.location.hash || "");
  if (action.type === "event") {
    showEventDetail(action.eventId);
    return;
  }
  if (action.type === "tab") {
    if (!state.auth.currentUser && action.tab === "judge-open") {
      window.location.hash = "";
      hideEventDetail();
      return;
    }
    const role = state.auth.userProfile?.role || null;
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
    setTab(action.tab, { force: true });
  }
  hideEventDetail();
}

export function updateRoleUI() {
  if (!state.auth.currentUser) {
    document.body.classList.add("auth-locked");
    document.body.classList.remove("director-only");
    setMainInteractionDisabled(true);
    if (els.roleTabBar) {
      els.roleTabBar.classList.add("is-hidden");
    }
    if (els.adminCard) els.adminCard.style.display = "none";
    if (els.judgeCard) els.judgeCard.style.display = "none";
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
    if (els.roleTabBar) {
      els.roleTabBar.classList.add("is-hidden");
    }
    if (els.adminCard) els.adminCard.style.display = "none";
    if (els.judgeCard) els.judgeCard.style.display = "none";
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
    if (els.roleTabBar) {
      els.roleTabBar.classList.add("is-hidden");
    }
    if (els.adminCard) els.adminCard.style.display = "none";
    if (els.judgeCard) els.judgeCard.style.display = "none";
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
  const effectiveRole = getEffectiveRole(state.auth.userProfile);
  setMainInteractionDisabled(false);
  if (els.roleTabBar) {
    els.roleTabBar.classList.remove("is-hidden");
  }
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
    button.style.display = allowed ? "inline-flex" : "none";
  });
  const defaultTab = getDefaultTabForRole(effectiveRole);
  setTab(defaultTab, { force: true });
  if (effectiveRole === "director") {
    const name =
      state.auth.userProfile.displayName ||
      state.auth.currentUser?.displayName ||
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
  if (state.subscriptions.scheduleEnsembles) state.subscriptions.scheduleEnsembles();
  if (state.subscriptions.openPackets) state.subscriptions.openPackets();
  if (state.subscriptions.openSessions) state.subscriptions.openSessions();
  if (state.subscriptions.openPacketsAdmin) state.subscriptions.openPacketsAdmin();
  if (state.subscriptions.eventDetailScheduleDraft) state.subscriptions.eventDetailScheduleDraft();
  if (state.subscriptions.eventDetailSchedulePublished) state.subscriptions.eventDetailSchedulePublished();
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
  state.subscriptions.scheduleEnsembles = null;
  state.subscriptions.openPackets = null;
  state.subscriptions.openSessions = null;
  state.subscriptions.openPacketsAdmin = null;
  state.subscriptions.eventDetailScheduleDraft = null;
  state.subscriptions.eventDetailSchedulePublished = null;
}

export function startWatchers() {
  stopWatchers();
  watchEvents(() => {
    renderEventList();
    renderDirectorEventOptions();
    if (els.eventDetailPage && !els.eventDetailPage.classList.contains("is-hidden")) {
      const detailEventId = els.eventDetailPage.dataset.eventId || "";
      if (detailEventId) {
        showEventDetail(detailEventId);
      }
    }
  });
  watchActiveEvent(() => {
    const activeEventId = state.event.active?.id || "";
    if (state.admin.logisticsEntriesCacheEventId !== activeEventId) {
      state.admin.logisticsEntriesCacheEventId = activeEventId;
      state.admin.logisticsEntriesCache.clear();
    }
    state.admin.dutiesEntriesByEnsembleId.clear();
    state.admin.dutiesRows = [];
    invalidateDirectorSchoolLunchTotalCache({
      eventId: state.director.selectedEventId || state.event.active?.id || null,
      schoolId: getDirectorSchoolId() || null,
    });
    renderActiveEventDisplay();
    updateAdminEmptyState();
    renderDirectorEventOptions();
    renderAdminReadiness();
    refreshOpenEventDefaultsState();
    refreshJudgeOpenDirectorReference({ persistToPacket: true });
    refreshAdminLogisticsEntry();
    refreshAdminDutiesPanel();
    refreshAdminDutiesOverview();
    startActiveAssignmentsWatcher();
  });
  startActiveAssignmentsWatcher();
  watchRoster((entries) => {
    renderAdminScheduleList(entries);
    renderAdminDutiesRows();
  });
  watchSchools(() => {
    state.admin.logisticsEnsemblesCache.clear();
    renderAdminSchoolsDirectory();
    if (
      state.admin.schoolEditId &&
      !state.admin.schoolsList.some((school) => school.id === state.admin.schoolEditId)
    ) {
      resetAdminSchoolForm();
    }
    refreshSchoolDropdowns();
    if (els.adminDutiesSchoolSelect && !els.adminDutiesSchoolSelect.value && state.admin.schoolsList.length) {
      els.adminDutiesSchoolSelect.value = state.admin.schoolsList[0].id || "";
    }
    if (!els.adminLogisticsCurrentSchoolSelect?.value) {
      state.admin.logisticsCurrentEnsembles = [];
      renderAdminLogisticsEnsembleOptions(els.adminLogisticsCurrentEnsembleSelect, []);
    }
    if (!els.adminLogisticsNextSchoolSelect?.value) {
      state.admin.logisticsNextEnsembles = [];
      renderAdminLogisticsEnsembleOptions(els.adminLogisticsNextEnsembleSelect, []);
    }
    refreshAdminLogisticsEntry();
    refreshAdminDutiesPanel();
    refreshAdminDutiesOverview();
    if (els.eventDetailPage && !els.eventDetailPage.classList.contains("is-hidden")) {
      refreshEventScheduleAddEnsembles();
    }
    if (canUseOpenJudge(state.auth.userProfile)) {
      const key = JSON.stringify(
        (state.admin.schoolsList || [])
          .map((school) => [school.id || "", school.name || ""])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );
      if (key !== state.judgeOpen.existingEnsembleIndexKey) {
        state.judgeOpen.existingEnsembleIndexKey = key;
        const loadVersion = (state.judgeOpen.existingEnsembleIndexLoadVersion || 0) + 1;
        state.judgeOpen.existingEnsembleIndexLoadVersion = loadVersion;
        fetchOpenEnsembleIndex(state.admin.schoolsList)
          .then((items) => {
            if (state.judgeOpen.existingEnsembleIndexLoadVersion !== loadVersion) return;
            state.judgeOpen.existingEnsembles = items;
            renderOpenExistingOptions(items);
          })
          .catch((error) => {
            console.error("fetchOpenEnsembleIndex failed", error);
          });
      }
    }
  });

  refreshDirectorWatchers();
  refreshOpenEventDefaultsState();
  if (canUseOpenJudge(state.auth.userProfile)) {
    state.subscriptions.openPackets = watchOpenPackets((packets) => {
      renderOpenPacketOptions(packets || []);
    });
  }
  if (getEffectiveRole(state.auth.userProfile) === "admin") {
    watchJudges((judges) => {
      renderJudgeOptions(judges);
    });
    state.subscriptions.openPacketsAdmin = watchOpenPacketsAdmin((packets) => {
      renderAdminOpenPackets(packets || []);
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
    loadDirectorEntry({
      onUpdate: applyDirectorEntryUpdate,
      onClear: applyDirectorEntryClear,
    });
  });
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
  setTab("judge-open");
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
    activeBadge.textContent = event.isActive ? "Active" : "Inactive";

    const activateBtn = document.createElement("button");
    activateBtn.className = "ghost";
    activateBtn.textContent = event.isActive ? "Active" : "Set Active";
    activateBtn.disabled = Boolean(event.isActive);
    activateBtn.style.display = event.isActive ? "none" : "inline-flex";
    activateBtn.addEventListener("click", async () => {
      await setActiveEvent(event.id);
    });

    const deactivateBtn = document.createElement("button");
    deactivateBtn.className = "ghost";
    deactivateBtn.textContent = "Deactivate";
    deactivateBtn.style.display = event.isActive ? "inline-flex" : "none";
    deactivateBtn.addEventListener("click", async () => {
      await setActiveEvent("");
    });

    const detailBtn = document.createElement("button");
    detailBtn.className = "ghost";
    detailBtn.textContent = "View Details";
    detailBtn.addEventListener("click", () => {
      window.location.hash = `#event/${event.id}`;
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

export function renderScheduleEnsembles(ensembles = []) {
  if (!els.scheduleEnsembleSelect) return;
  els.scheduleEnsembleSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = ensembles.length ? "Select an ensemble" : "No ensembles";
  els.scheduleEnsembleSelect.appendChild(placeholder);
  ensembles.forEach((ensemble) => {
    const option = document.createElement("option");
    option.value = ensemble.id;
    option.textContent = ensemble.name || ensemble.id;
    els.scheduleEnsembleSelect.appendChild(option);
  });
  if (els.scheduleEnsembleHint) {
    els.scheduleEnsembleHint.textContent = ensembles.length
      ? ""
      : "No ensembles for this school yet.";
  }
  updateScheduleSubmitState();
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
    const packet = state.judgeOpen.currentPacket || {};
    els.judgeOpenStatusBadge.textContent = packet.status || "Draft";
  }
  if (show) {
    hideOpenDetailView();
  }
}

export function renderOpenPacketOptions(packets) {
  if (!els.judgeOpenPacketSelect) return;
  els.judgeOpenPacketSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = packets.length ? "Select a packet" : "No packets yet";
  els.judgeOpenPacketSelect.appendChild(placeholder);
  packets.forEach((packet) => {
    const option = document.createElement("option");
    option.value = packet.id;
    option.textContent = packet.display || packet.id;
    els.judgeOpenPacketSelect.appendChild(option);
  });
  renderOpenPacketCards(packets);
}

function formatPacketUpdatedAt(packet) {
  const raw = packet.updatedAt?.toMillis ? packet.updatedAt.toMillis() : null;
  if (!raw) return "Updated recently";
  return new Date(raw).toLocaleString();
}

function computePacketProgress(packet) {
  if (!packet) return 0;
  if (["submitted", "locked", "released"].includes(packet.status)) return 100;
  const hasTranscript = Boolean(packet.transcriptFull || packet.transcript);
  const hasCaptions = packet.captions && Object.keys(packet.captions).length > 0;
  if (hasTranscript && hasCaptions) return 75;
  if (packet.segmentCount || packet.audioSessionCount) return 40;
  return 10;
}

function renderOpenPacketCards(packets) {
  if (!els.judgeOpenPacketList) return;
  els.judgeOpenPacketList.innerHTML = "";
  packets.forEach((packet) => {
    const card = document.createElement("div");
    card.className = "packet-card";
    card.dataset.packetId = packet.id;
    const progress = computePacketProgress(packet);
    const statusRaw = packet.status || "draft";
    const status = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
    const creator =
      packet.createdByJudgeName ||
      packet.createdByJudgeEmail ||
      packet.createdByJudgeUid ||
      "Unknown judge";
    card.innerHTML = `
      <div class="packet-card-header">
        <div class="packet-card-title">${packet.schoolName || "Unknown school"} - ${packet.ensembleName || "Unknown ensemble"}</div>
        <span class="status-badge">${status}</span>
      </div>
      <div class="packet-card-meta">Judge: ${creator}</div>
      <div class="packet-card-meta">${formatPacketUpdatedAt(packet)}</div>
      <div class="progress-bar"><span style="width: ${progress}%"></span></div>
    `;
    const actions = document.createElement("div");
    actions.className = "row";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const label = `${packet.schoolName || "Unknown school"} - ${packet.ensembleName || "Unknown ensemble"}`;
      if (!confirmUser(`Delete open packet for ${label}? This removes packet audio and sessions.`)) {
        return;
      }
      deleteBtn.dataset.loadingLabel = "Deleting...";
      deleteBtn.dataset.spinner = "true";
      await withLoading(deleteBtn, async () => {
        await deleteOpenPacket({ packetId: packet.id });
        if (state.judgeOpen.currentPacketId === packet.id) {
          resetJudgeOpenState();
          setJudgeOpenDirectorReferenceState(
            "not-linked",
            "Link an existing ensemble to load Director repertoire/instrumentation.",
            null
          );
          renderJudgeOpenDirectorReference();
          if (els.judgeOpenPacketSelect) els.judgeOpenPacketSelect.value = "";
          if (els.judgeOpenExistingSelect) els.judgeOpenExistingSelect.value = "";
          if (els.judgeOpenSchoolNameInput) els.judgeOpenSchoolNameInput.value = "";
          if (els.judgeOpenEnsembleNameInput) els.judgeOpenEnsembleNameInput.value = "";
          if (els.judgeOpenTranscriptInput) els.judgeOpenTranscriptInput.value = "";
          if (els.judgeOpenDraftStatus) els.judgeOpenDraftStatus.textContent = "";
          renderOpenSegments([]);
          renderOpenCaptionForm();
          updateOpenHeader();
          hideOpenDetailView();
          updateOpenEmptyState();
          updateOpenSubmitState();
          saveOpenPrefs({ lastPacketId: "" });
          try {
            await saveOpenPrefsToServer({ lastJudgeOpenPacketId: "" });
          } catch (error) {
            console.error("Clear open packet preference failed", error);
          }
          if (state.auth.userProfile) {
            state.auth.userProfile.preferences = {
              ...(state.auth.userProfile.preferences || {}),
              lastJudgeOpenPacketId: "",
            };
          }
        }
        setOpenPacketHint("Packet deleted.");
      });
    });
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
    card.addEventListener("click", () => {
      if (els.judgeOpenPacketSelect) {
        els.judgeOpenPacketSelect.value = packet.id;
      }
      openJudgeOpenPacket(packet.id);
    });
    els.judgeOpenPacketList.appendChild(card);
  });
}

function updateOpenHeader() {
  if (!els.judgeOpenHeaderTitle || !els.judgeOpenHeaderSub) return;
  const packet = state.judgeOpen.currentPacket || {};
  const school = packet.schoolName || "School";
  const ensemble = packet.ensembleName || "Ensemble";
  const statusRaw = String(packet.status || "draft");
  const statusLabel = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : "Draft";
  const title = `${school} - ${ensemble}`;
  els.judgeOpenHeaderTitle.textContent = title;
  els.judgeOpenHeaderSub.textContent = statusLabel;
  if (els.judgeOpenSummaryTitle) {
    els.judgeOpenSummaryTitle.textContent = title;
  }
  if (els.judgeOpenSummaryStatus) {
    els.judgeOpenSummaryStatus.textContent = statusLabel;
  }
  if (els.judgeOpenSummaryMeta) {
    const formLabel = (packet.formType || state.judgeOpen.formType || "stage") === "sight"
      ? "Sight Reading"
      : "Stage";
    const segments = Number(packet.segmentCount || packet.audioSessionCount || 0);
    els.judgeOpenSummaryMeta.textContent = `${formLabel} packet - ${segments} segment${segments === 1 ? "" : "s"}`;
  }
  if (els.judgeOpenSummaryHint) {
    if (!state.judgeOpen.currentPacketId) {
      els.judgeOpenSummaryHint.textContent = "Create or select a packet to begin.";
    } else if (statusRaw === "released") {
      els.judgeOpenSummaryHint.textContent = "This packet has been released.";
    } else if (statusRaw === "submitted" || statusRaw === "locked") {
      els.judgeOpenSummaryHint.textContent = "Packet is submitted and locked.";
    } else {
      els.judgeOpenSummaryHint.textContent = "Complete the steps below, then submit the packet.";
    }
  }
}

function setJudgeOpenDirectorReferenceState(status, message = "", snapshot = null) {
  state.judgeOpen.directorEntryReferenceStatus = status;
  state.judgeOpen.directorEntryReferenceMessage = message || "";
  state.judgeOpen.directorEntryReference = snapshot || null;
}

function renderJudgeOpenDirectorReference() {
  if (!els.judgeOpenDirectorRefStatus || !els.judgeOpenDirectorRefContent) return;
  const status = state.judgeOpen.directorEntryReferenceStatus || "idle";
  const message = state.judgeOpen.directorEntryReferenceMessage || "";
  const snapshot = state.judgeOpen.directorEntryReference || null;
  els.judgeOpenDirectorRefStatus.textContent =
    message ||
    (status === "loading"
      ? "Loading Director repertoire/instrumentation..."
      : "Link an existing ensemble to load Director repertoire/instrumentation.");
  els.judgeOpenDirectorRefContent.innerHTML = "";

  if (!snapshot || status !== "loaded") return;

  const sourceRow = document.createElement("div");
  sourceRow.className = "note";
  const sourceName = snapshot.source?.eventName || snapshot.source?.eventId || "Active Event";
  sourceRow.textContent = `Loaded from Director entry for ${sourceName}`;
  els.judgeOpenDirectorRefContent.appendChild(sourceRow);

  const repPanel = document.createElement("div");
  repPanel.className = "panel";
  const repTitle = document.createElement("strong");
  repTitle.textContent = "Repertoire";
  repPanel.appendChild(repTitle);
  const repList = document.createElement("div");
  repList.className = "stack";
  const rep = snapshot.repertoire || {};
  const gradeText = snapshot.performanceGrade
    ? `${snapshot.performanceGrade}${snapshot.performanceGradeFlex ? "-Flex" : ""}`
    : "N/A";
  [
    ["Performance Grade", gradeText],
    ["March", [rep.march?.title, rep.march?.composer].filter(Boolean).join(" - ") || "Not provided"],
    [
      "Selection #1",
      [
        rep.selection1?.grade || "",
        rep.selection1?.title || "",
        rep.selection1?.composer || "",
      ]
        .filter(Boolean)
        .join(" - ") || "Not provided",
    ],
    [
      "Selection #2",
      [
        rep.selection2?.grade || "",
        rep.selection2?.title || "",
        rep.selection2?.composer || "",
      ]
        .filter(Boolean)
        .join(" - ") || "Not provided",
    ],
    [
      "Masterwork Exception",
      rep.repertoireRuleMode === "masterwork" ? "Yes" : "No",
    ],
  ].forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "note";
    row.textContent = `${label}: ${value}`;
    repList.appendChild(row);
  });
  repPanel.appendChild(repList);
  els.judgeOpenDirectorRefContent.appendChild(repPanel);

  const instrumentation = snapshot.instrumentation || {};
  const instPanel = document.createElement("div");
  instPanel.className = "panel";
  const instTitle = document.createElement("strong");
  instTitle.textContent = "Instrumentation";
  instPanel.appendChild(instTitle);
  const instList = document.createElement("div");
  instList.className = "stack";
  const standardCounts = instrumentation.standardCounts || {};
  const leftColumnKeys = [
    "flute",
    "oboe",
    "bassoon",
    "clarinet",
    "bassClarinet",
    "altoSax",
    "tenorSax",
    "bariSax",
  ];
  const rightColumnKeys = [
    "trumpetCornet",
    "horn",
    "trombone",
    "euphoniumBaritone",
    "tuba",
  ];
  const labelsByKey = Object.fromEntries(
    STANDARD_INSTRUMENTS.map((item) => [item.key, item.label])
  );
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  grid.style.gap = "8px 16px";
  const col1 = document.createElement("div");
  col1.className = "stack";
  col1.style.gap = "4px";
  const col2 = document.createElement("div");
  col2.className = "stack";
  col2.style.gap = "4px";
  const addCountRow = (parent, label, count) => {
    const row = document.createElement("div");
    row.className = "note";
    row.textContent = `${label}: ${Number(count || 0)}`;
    parent.appendChild(row);
  };
  leftColumnKeys.forEach((key) => {
    addCountRow(col1, labelsByKey[key] || key, standardCounts[key]);
  });
  rightColumnKeys.forEach((key) => {
    addCountRow(col2, labelsByKey[key] || key, standardCounts[key]);
  });
  addCountRow(col2, "Percussion", instrumentation.totalPercussion);
  grid.appendChild(col1);
  grid.appendChild(col2);
  instList.appendChild(grid);
  if (Array.isArray(instrumentation.nonStandard) && instrumentation.nonStandard.length) {
    const nonStandardRow = document.createElement("div");
    nonStandardRow.className = "note";
    nonStandardRow.textContent = `Non-standard: ${instrumentation.nonStandard
      .filter((row) => row?.instrumentName)
      .map((row) => `${row.instrumentName}${Number(row.count || 0) ? ` (${Number(row.count || 0)})` : ""}`)
      .join(" - ")}`;
    instList.appendChild(nonStandardRow);
  }
  if (instrumentation.otherInstrumentationNotes) {
    const noteRow = document.createElement("div");
    noteRow.className = "note";
    noteRow.textContent = `Notes: ${instrumentation.otherInstrumentationNotes}`;
    instList.appendChild(noteRow);
  }
  instPanel.appendChild(instList);
  els.judgeOpenDirectorRefContent.appendChild(instPanel);
}

async function refreshJudgeOpenDirectorReference({ persistToPacket = true } = {}) {
  if (!els.judgeOpenDirectorRefStatus || !els.judgeOpenDirectorRefContent) return;
  const existing = state.judgeOpen.selectedExisting;
  if (!existing?.schoolId || !existing?.ensembleId) {
    setJudgeOpenDirectorReferenceState(
      "not-linked",
      "Link an existing ensemble to load Director repertoire/instrumentation.",
      null
    );
    renderJudgeOpenDirectorReference();
    if (persistToPacket) {
      syncOpenDirectorEntrySnapshotDraft(null);
    }
    return;
  }
  const activeEvent = state.event.active || null;
  if (!activeEvent?.id) {
    setJudgeOpenDirectorReferenceState(
      "no-active-event",
      "No active event. Director repertoire/instrumentation unavailable.",
      null
    );
    renderJudgeOpenDirectorReference();
    if (persistToPacket) {
      syncOpenDirectorEntrySnapshotDraft(null);
    }
    return;
  }

  const version = (state.judgeOpen.directorEntryReferenceLoadVersion || 0) + 1;
  state.judgeOpen.directorEntryReferenceLoadVersion = version;
  setJudgeOpenDirectorReferenceState("loading", "Loading Director repertoire/instrumentation...", null);
  renderJudgeOpenDirectorReference();
  try {
    const result = await loadDirectorEntrySnapshotForJudge({
      eventId: activeEvent.id,
      ensembleId: existing.ensembleId,
    });
    if (state.judgeOpen.directorEntryReferenceLoadVersion !== version) return;
    if (!result?.ok) {
      const message =
        result?.reason === "not-found"
          ? "No Director entry found for this ensemble in the active event."
          : result?.reason === "no-event"
            ? "No active event. Director repertoire/instrumentation unavailable."
            : (result?.message || "Unable to load Director entry reference.");
      setJudgeOpenDirectorReferenceState(result?.reason || "error", message, null);
      renderJudgeOpenDirectorReference();
      if (persistToPacket) {
        syncOpenDirectorEntrySnapshotDraft(null);
      }
      return;
    }
    setJudgeOpenDirectorReferenceState("loaded", "", result.snapshot);
    renderJudgeOpenDirectorReference();
    if (persistToPacket) {
      syncOpenDirectorEntrySnapshotDraft(result.snapshot);
    }
  } catch (error) {
    console.error("refreshJudgeOpenDirectorReference failed", error);
    if (state.judgeOpen.directorEntryReferenceLoadVersion !== version) return;
    setJudgeOpenDirectorReferenceState("error", "Unable to load Director entry reference.", null);
    renderJudgeOpenDirectorReference();
  }
}

function areDirectorEntrySnapshotsEqual(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

function syncOpenDirectorEntrySnapshotDraft(nextSnapshot) {
  const currentPacket = state.judgeOpen.currentPacket || {};
  const currentSnapshot = currentPacket.directorEntrySnapshot || null;
  if (areDirectorEntrySnapshotsEqual(currentSnapshot, nextSnapshot || null)) {
    return;
  }
  state.judgeOpen.currentPacket = {
    ...currentPacket,
    directorEntrySnapshot: nextSnapshot || null,
  };
  if (!state.judgeOpen.currentPacketId) return;
  updateOpenPacketDraft({ directorEntrySnapshot: nextSnapshot || null }).catch((error) => {
    console.error("Failed syncing open packet director snapshot", error);
  });
}

function updateRoleTabBar(role) {
  if (!els.roleTabBar) return;
  const groups = els.roleTabGroups || [];
  groups.forEach((group) => {
    const show = group.dataset.role === role;
    group.style.display = show ? "contents" : "none";
    if (show) {
      const buttons = group.querySelectorAll("button");
      buttons.forEach((btn, index) => {
        btn.setAttribute("aria-selected", index === 0 ? "true" : "false");
      });
    }
  });
}

function scrollToSection(target) {
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showOpenDetailView() {
  if (els.judgeOpenListView) {
    els.judgeOpenListView.style.display = "none";
  }
  if (els.judgeOpenDetailView) {
    els.judgeOpenDetailView.classList.add("is-open");
    els.judgeOpenDetailView.style.display = "grid";
  }
}

function hideOpenDetailView() {
  if (els.judgeOpenListView) {
    els.judgeOpenListView.style.display = "grid";
  }
  if (els.judgeOpenDetailView) {
    els.judgeOpenDetailView.classList.remove("is-open");
    els.judgeOpenDetailView.style.display = "none";
  }
}

function syncOpenFormTypeSegmented() {
  if (!els.judgeOpenFormTypeSegmented) return;
  const buttons = els.judgeOpenFormTypeSegmented.querySelectorAll("[data-form]");
  buttons.forEach((button) => {
    const isActive = button.dataset.form === (state.judgeOpen.formType || "stage");
    button.classList.toggle("is-active", isActive);
  });
}

async function openJudgeOpenPacket(packetId) {
  if (!packetId) return;
  const result = await selectOpenPacket(packetId, { onSessions: renderOpenSegments });
  if (result?.ok) {
    state.judgeOpen.tapePlaylistIndex = 0;
    if (els.judgeOpenSchoolNameInput) {
      els.judgeOpenSchoolNameInput.value = result.packet.schoolName || "";
    }
    if (els.judgeOpenEnsembleNameInput) {
      els.judgeOpenEnsembleNameInput.value = result.packet.ensembleName || "";
    }
    if (els.judgeOpenFormTypeSelect) {
      els.judgeOpenFormTypeSelect.value = result.packet.formType || "stage";
    }
    syncOpenFormTypeSegmented();
    if (els.judgeOpenExistingSelect) {
      if (result.packet.ensembleId) {
        els.judgeOpenExistingSelect.value = `${result.packet.schoolId}:${result.packet.ensembleId}`;
      } else {
        els.judgeOpenExistingSelect.value = "";
      }
    }
    if (els.judgeOpenTranscriptInput) {
      els.judgeOpenTranscriptInput.value =
        result.packet.transcriptFull || result.packet.transcript || "";
    }
    if (result.packet.directorEntrySnapshot) {
      setJudgeOpenDirectorReferenceState("loaded", "", result.packet.directorEntrySnapshot);
    } else {
      setJudgeOpenDirectorReferenceState("idle", "", null);
    }
    renderJudgeOpenDirectorReference();
    refreshJudgeOpenDirectorReference({ persistToPacket: false });
    renderOpenCaptionForm();
    updateOpenHeader();
    updateOpenEmptyState();
    updateOpenSubmitState();
    showOpenDetailView();
    await saveOpenPrefsToServer({
      lastJudgeOpenPacketId: packetId,
      lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
    });
    if (state.auth.userProfile) {
      state.auth.userProfile.preferences = {
        ...(state.auth.userProfile.preferences || {}),
        lastJudgeOpenPacketId: packetId,
        lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
      };
    }
  }
}

export function renderOpenExistingOptions(items) {
  if (!els.judgeOpenExistingSelect) return;
  els.judgeOpenExistingSelect.innerHTML = "";
  const sorted = [...items].sort((a, b) => {
    const school = (a.schoolName || "").localeCompare(b.schoolName || "");
    if (school !== 0) return school;
    return (a.ensembleName || "").localeCompare(b.ensembleName || "");
  });
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = items.length ? "Select existing ensemble" : "No ensembles available";
  els.judgeOpenExistingSelect.appendChild(placeholder);
  sorted.forEach((item) => {
    const option = document.createElement("option");
    option.value = `${item.schoolId}:${item.ensembleId}`;
    option.textContent = `${item.schoolName} — ${item.ensembleName}`;
    option.dataset.schoolId = item.schoolId;
    option.dataset.schoolName = item.schoolName;
    option.dataset.ensembleId = item.ensembleId;
    option.dataset.ensembleName = item.ensembleName;
    els.judgeOpenExistingSelect.appendChild(option);
  });
  if (state.judgeOpen.selectedExisting?.ensembleId) {
    els.judgeOpenExistingSelect.value = `${state.judgeOpen.selectedExisting.schoolId}:${state.judgeOpen.selectedExisting.ensembleId}`;
  }
}

export function renderOpenCaptionForm() {
  if (!els.judgeOpenCaptionForm) return;
  els.judgeOpenCaptionForm.innerHTML = "";
  const template = getOpenCaptionTemplate();
  template.forEach(({ key, label }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "caption-card";
    wrapper.dataset.key = key;
    wrapper.innerHTML = `
      <div class="caption-body">
        <div class="caption-main">
          <div class="caption-header-row">
            <div class="caption-title">${label}</div>
            <div class="caption-segments" data-grade-group>
              <button type="button" data-grade="A">A</button>
              <button type="button" data-grade="B">B</button>
              <button type="button" data-grade="C">C</button>
              <button type="button" data-grade="D">D</button>
              <button type="button" data-grade="F">F</button>
            </div>
          </div>
          <textarea rows="2" data-comment></textarea>
        </div>
        <div class="caption-grade-rail">
          <div class="caption-modifiers" data-modifier-group>
            <button type="button" data-modifier="+">+</button>
            <button type="button" data-modifier="-">-</button>
          </div>
        </div>
      </div>
    `;
    els.judgeOpenCaptionForm.appendChild(wrapper);
  });
  applyOpenCaptionState();
}

function areOpenCaptionsComplete() {
  const template = getOpenCaptionTemplate();
  return template.every(({ key }) => {
    const grade = state.judgeOpen.captions[key]?.gradeLetter;
    return Boolean(grade);
  });
}

export function applyOpenCaptionState() {
  const template = getOpenCaptionTemplate();
  template.forEach(({ key }) => {
    const wrapper = els.judgeOpenCaptionForm?.querySelector(`[data-key="${key}"]`);
    if (!wrapper) return;
    const caption = state.judgeOpen.captions[key] || {};
    const comment = wrapper.querySelector("[data-comment]");
    const gradeButtons = wrapper.querySelectorAll("[data-grade]");
    gradeButtons.forEach((btn) => {
      const active = btn.dataset.grade === caption.gradeLetter;
      btn.classList.toggle("is-active", active);
    });
    const modifierButtons = wrapper.querySelectorAll("[data-modifier]");
    modifierButtons.forEach((btn) => {
      const active = btn.dataset.modifier === caption.gradeModifier;
      btn.classList.toggle("is-active", active);
    });
    if (comment) comment.value = caption.comment || "";
  });
  const complete = areOpenCaptionsComplete();
  const total = calculateCaptionTotal(state.judgeOpen.captions);
  const rating = complete ? computeFinalRating(total) : { label: "N/A", value: null };
  if (els.judgeOpenCaptionTotal) {
    els.judgeOpenCaptionTotal.textContent = complete ? String(total) : "Incomplete";
  }
  if (els.judgeOpenFinalRating) {
    els.judgeOpenFinalRating.textContent = rating.label;
  }
}

export function renderOpenSegments(sessions) {
  if (!els.judgeOpenSegmentsList) return;
  els.judgeOpenSegmentsList.innerHTML = "";
  const ordered = [...sessions].sort((a, b) => {
    const aTime = a.startedAt?.toMillis
      ? a.startedAt.toMillis()
      : a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : 0;
    const bTime = b.startedAt?.toMillis
      ? b.startedAt.toMillis()
      : b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : 0;
    if (aTime && bTime) return aTime - bTime;
    return 0;
  });
  if (els.judgeOpenSegmentsDetails) {
    const hint = els.judgeOpenSegmentsDetails.querySelector(".readiness-hint");
    if (hint) hint.textContent = `${ordered.length} segments`;
  }
  if (els.judgeOpenSegmentsSummary) {
    els.judgeOpenSegmentsSummary.textContent = `Segments (${ordered.length})`;
  }
  ordered.forEach((session, index) => {
    const item = document.createElement("li");
    item.className = "list-item";
    const status = session.status || "recording";
    const meta = document.createElement("div");
    meta.className = "stack";
    const title = document.createElement("strong");
    title.textContent = `Segment ${index + 1}`;
    const hint = document.createElement("div");
    hint.className = "note";
    const duration = formatDuration(Number(session.durationSec || 0));
    const transcriptStatus = session.transcriptStatus || "idle";
    const startedAtLabel = session.startedAt ? formatPerformanceAt(session.startedAt) : "";
    const startedText = startedAtLabel ? ` - ${startedAtLabel}` : "";
    hint.textContent = `${status} - ${duration}${startedText} - transcript ${transcriptStatus}${
      session.needsUpload ? " - needs upload" : ""
    }`;
    meta.appendChild(title);
    meta.appendChild(hint);
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    if (session.needsUpload) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "ghost";
      retryBtn.textContent = "Retry Upload";
      retryBtn.addEventListener("click", async () => {
        const result = await retryOpenSessionUploads(session.id);
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Retry failed.");
        } else {
          setOpenPacketHint("Retry completed.");
        }
      });
      actions.appendChild(retryBtn);
    }
    const retryTranscriptBtn = document.createElement("button");
    retryTranscriptBtn.className = "ghost";
    retryTranscriptBtn.textContent = "Retry Transcription";
    retryTranscriptBtn.addEventListener("click", async () => {
      const result = await transcribeOpenSegment({ sessionId: session.id });
      if (!result?.ok) {
        setOpenPacketHint(result?.message || "Segment transcription failed.");
      } else {
        setOpenPacketHint("Segment transcription complete.");
      }
    });
    actions.appendChild(retryTranscriptBtn);
    item.appendChild(actions);

    if (session.masterAudioUrl) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = session.masterAudioUrl;
      audio.className = "audio";
      item.appendChild(audio);
    }

    els.judgeOpenSegmentsList.appendChild(item);
  });
  updateTapePlayback(ordered);
}

export function updateOpenSubmitState() {
  const packet = state.judgeOpen.currentPacket || {};
  const editable = isOpenPacketEditable(packet);
  const complete = areOpenCaptionsComplete();
  const transcriptReady = Boolean(state.judgeOpen.transcriptText?.trim());
  const pendingUploads = state.judgeOpen.pendingUploads > 0;
  const recordingActive = state.judgeOpen.mediaRecorder?.state === "recording";
  const canSubmit =
    editable && complete && transcriptReady && !pendingUploads && !recordingActive;
  if (els.judgeOpenSubmitBtn) {
    els.judgeOpenSubmitBtn.disabled = !canSubmit;
  }
  if (els.judgeOpenTranscriptInput) {
    els.judgeOpenTranscriptInput.disabled = !editable;
  }
  if (els.judgeOpenDraftBtn) {
    els.judgeOpenDraftBtn.disabled = !editable;
  }
  if (els.judgeOpenTranscribeBtn) {
    els.judgeOpenTranscribeBtn.disabled = !editable;
  }
  if (els.judgeOpenRecordBtn) {
    els.judgeOpenRecordBtn.disabled = !editable;
  }
  if (els.judgeOpenStopBtn) {
    els.judgeOpenStopBtn.disabled = !editable;
  }
}

export async function restoreOpenPacketFromPrefs() {
  if (state.judgeOpen.restoreAttempted) return;
  state.judgeOpen.restoreAttempted = true;
  if (!canUseOpenJudge(state.auth.userProfile)) return;
  const local = loadOpenPrefs();
  const prefs = state.auth.userProfile?.preferences || {};
  state.judgeOpen.useActiveEventDefaults =
    typeof prefs.judgeOpenUseActiveEventDefaults === "boolean"
      ? prefs.judgeOpenUseActiveEventDefaults
      : local.useActiveEventDefaults !== false;
  syncOpenEventDefaultsUI();
  refreshOpenEventDefaultsState();
  const defaultFormType = prefs.judgeOpenDefaultFormType || local.defaultFormType || "stage";
  const lastFormType = prefs.lastJudgeOpenFormType || local.lastFormType || defaultFormType;
  state.judgeOpen.formType = lastFormType || "stage";
  if (els.judgeOpenFormTypeSelect) {
    els.judgeOpenFormTypeSelect.value = state.judgeOpen.formType;
  }
  syncOpenFormTypeSegmented();
  renderOpenCaptionForm();
  applyOpenEventAssignmentDefaults();

  const lastPacketId = prefs.lastJudgeOpenPacketId || local.lastPacketId;
  if (!lastPacketId) {
    updateOpenEmptyState();
    updateOpenSubmitState();
    return;
  }
  const result = await selectOpenPacket(lastPacketId, { onSessions: renderOpenSegments });
  if (result?.ok) {
    if (els.judgeOpenPacketSelect) {
      els.judgeOpenPacketSelect.value = lastPacketId;
    }
    if (els.judgeOpenSchoolNameInput) {
      els.judgeOpenSchoolNameInput.value = result.packet.schoolName || "";
    }
    if (els.judgeOpenEnsembleNameInput) {
      els.judgeOpenEnsembleNameInput.value = result.packet.ensembleName || "";
    }
    if (els.judgeOpenExistingSelect) {
      els.judgeOpenExistingSelect.value = result.packet.ensembleId
        ? `${result.packet.schoolId}:${result.packet.ensembleId}`
        : "";
    }
    if (els.judgeOpenTranscriptInput) {
      els.judgeOpenTranscriptInput.value =
        result.packet.transcriptFull || result.packet.transcript || "";
    }
    if (result.packet.directorEntrySnapshot) {
      setJudgeOpenDirectorReferenceState("loaded", "", result.packet.directorEntrySnapshot);
    } else {
      setJudgeOpenDirectorReferenceState("idle", "", null);
    }
    renderJudgeOpenDirectorReference();
    refreshJudgeOpenDirectorReference({ persistToPacket: false });
    renderOpenCaptionForm();
    updateOpenHeader();
    showOpenDetailView();
    updateOpenEmptyState();
    updateOpenSubmitState();
    return;
  }
  setOpenPacketHint("Last packet not found.");
  updateOpenEmptyState();
  updateOpenSubmitState();
}

function formatDuration(totalSec) {
  if (!Number.isFinite(totalSec)) return "0:00";
  const seconds = Math.max(0, Math.floor(totalSec || 0));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function buildTapePlaylist(sessions) {
  return sessions
    .filter((session) => session.masterAudioUrl)
    .map((session) => ({
      id: session.id,
      url: session.masterAudioUrl,
      durationSec: Number(session.durationSec || 0),
    }));
}

function updateTapePlayback(sessions) {
  if (!els.judgeOpenTapePlayback) return;
  const playlist = buildTapePlaylist(sessions);
  state.judgeOpen.tapePlaylist = playlist;
  const totalDuration = sessions.reduce(
    (sum, item) => {
      const value = Number(item.durationSec);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    },
    0
  );
  const safeDuration = Number.isFinite(totalDuration) ? totalDuration : 0;
  state.judgeOpen.tapeDurationSec = safeDuration;
  if (els.judgeOpenTapeDuration) {
    els.judgeOpenTapeDuration.textContent = formatDuration(safeDuration);
  }
  const hasAudio = playlist.length > 0;
  if (els.judgeOpenTapeEmpty) {
    els.judgeOpenTapeEmpty.style.display = hasAudio ? "none" : "block";
  }
  if (els.judgeOpenTapePlayback) {
    els.judgeOpenTapePlayback.style.display = hasAudio ? "block" : "none";
  }
  if (els.judgeOpenTapeDurationRow) {
    els.judgeOpenTapeDurationRow.style.display = safeDuration > 0 ? "block" : "none";
  }
  if (!hasAudio) {
    els.judgeOpenTapePlayback.removeAttribute("src");
    return;
  }
  const current = state.judgeOpen.tapePlaylistIndex || 0;
  const bounded = current < playlist.length ? current : 0;
  state.judgeOpen.tapePlaylistIndex = bounded;
  if (els.judgeOpenTapePlayback.src !== playlist[bounded].url) {
    els.judgeOpenTapePlayback.src = playlist[bounded].url;
  }
}

export function renderAdminOpenPackets(packets) {
  if (!els.adminOpenPacketsList) return;
  els.adminOpenPacketsList.innerHTML = "";
  if (!packets.length) {
    if (els.adminOpenPacketsHint) {
      els.adminOpenPacketsHint.textContent = "No open packets yet.";
    }
    return;
  }
  if (els.adminOpenPacketsHint) {
    els.adminOpenPacketsHint.textContent = "";
  }
  const groups = new Map();
  packets.forEach((packet) => {
    const key = packet.ensembleId
      ? `${packet.assignmentEventId || "unassigned"}::${packet.ensembleId}`
      : `packet::${packet.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        schoolName: packet.schoolName || packet.schoolId || "Unknown school",
        ensembleName: packet.ensembleName || packet.ensembleId || "Unknown ensemble",
        packets: [],
      });
    }
    groups.get(key).packets.push(packet);
  });

  Array.from(groups.values())
    .sort((a, b) => String(a.ensembleName || "").localeCompare(String(b.ensembleName || "")))
    .forEach((group) => {
      const item = document.createElement("li");
      item.className = "list-item";
      const details = document.createElement("details");
      details.className = "stack";
      const summary = document.createElement("summary");
      const releasedCount = group.packets.filter((packet) => packet.status === "released").length;
      const statusLabel = releasedCount === group.packets.length
        ? "All Released"
        : releasedCount > 0
          ? `${releasedCount}/${group.packets.length} Released`
          : "Not Released";
      summary.textContent =
        `${group.ensembleName} (${group.schoolName}) • Judges: ${group.packets.length} • ${statusLabel}`;
      details.appendChild(summary);

      group.packets
        .sort((a, b) => String(a.judgePosition || "").localeCompare(String(b.judgePosition || "")))
        .forEach((packet) => {
          details.appendChild(buildAdminOpenPacketDetailRow(packet));
        });

      item.appendChild(details);
      els.adminOpenPacketsList.appendChild(item);
    });
}

function buildAdminOpenPacketDetailRow(packet) {
  const wrapper = document.createElement("div");
  wrapper.className = "panel stack";
  const school = packet.schoolName || packet.schoolId || "Unknown school";
  const ensemble = packet.ensembleName || packet.ensembleId || "Unknown ensemble";
  const creator =
    packet.createdByJudgeName ||
    packet.createdByJudgeEmail ||
    packet.createdByJudgeUid ||
    "Unknown judge";
  const assignmentEventId = packet.assignmentEventId || "";
  const linkedEvent = assignmentEventId
    ? state.event.list.find((event) => event.id === assignmentEventId)
    : null;
  const eventLabel = linkedEvent?.name || assignmentEventId || "Open (no event)";
  const judgePositionLabel =
    JUDGE_POSITION_LABELS[packet.judgePosition] || (packet.judgePosition ? packet.judgePosition : "Unassigned");

  const detail = document.createElement("div");
  detail.className = "note";
  detail.textContent =
    `Status: ${packet.status || "draft"} • Judge: ${creator} • Slot: ${judgePositionLabel} • Event: ${eventLabel}`;
  wrapper.appendChild(detail);

  const actions = document.createElement("div");
  actions.className = "actions";

  const slotSelect = document.createElement("select");
  slotSelect.className = "ghost";
  [
    { value: "", label: "No Slot" },
    { value: JUDGE_POSITIONS.stage1, label: "Stage 1" },
    { value: JUDGE_POSITIONS.stage2, label: "Stage 2" },
    { value: JUDGE_POSITIONS.stage3, label: "Stage 3" },
    { value: JUDGE_POSITIONS.sight, label: "Sight" },
  ].forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    slotSelect.appendChild(option);
  });
  slotSelect.value = packet.judgePosition || "";
  actions.appendChild(slotSelect);

  const slotBtn = document.createElement("button");
  slotBtn.className = "ghost";
  slotBtn.textContent = "Save Slot";
  slotBtn.disabled = packet.status === "released";
  if (packet.status === "released") {
    slotBtn.title = "Revoke packet before changing judge slot.";
  }
  slotBtn.addEventListener("click", async () => {
    try {
      await setOpenPacketJudgePosition({
        packetId: packet.id,
        judgePosition: slotSelect.value || "",
        assignmentEventId: state.event.active?.id || packet.assignmentEventId || "",
      });
    } catch (error) {
      console.error("Set open packet judge slot failed", error);
      alertUser(error?.message || "Unable to update judge slot.");
    }
  });
  actions.appendChild(slotBtn);

  const lockBtn = document.createElement("button");
  const isLocked = Boolean(packet.locked);
  lockBtn.textContent = isLocked ? "Unlock" : "Lock";
  lockBtn.className = "ghost";
  lockBtn.addEventListener("click", async () => {
    if (isLocked) {
      await unlockOpenPacket({ packetId: packet.id });
    } else {
      await lockOpenPacket({ packetId: packet.id });
    }
  });
  actions.appendChild(lockBtn);

  const releaseBtn = document.createElement("button");
  releaseBtn.className = "ghost";
  const isReleased = packet.status === "released";
  releaseBtn.textContent = isReleased ? "Revoke" : "Release";
  releaseBtn.disabled = !isReleased && !isLocked;
  if (!isReleased && !isLocked) {
    releaseBtn.title = "Lock packet before releasing.";
  }
  releaseBtn.addEventListener("click", async () => {
    try {
      if (isReleased) {
        await unreleaseOpenPacket({ packetId: packet.id });
        return;
      }
      await releaseOpenPacket({ packetId: packet.id });
    } catch (error) {
      console.error("Release/revoke open packet failed", error);
      alertUser(error?.message || "Unable to update packet release state.");
    }
  });
  actions.appendChild(releaseBtn);

  const packetPanel = document.createElement("div");
  packetPanel.className = "packet-panel is-hidden";

  const viewBtn = document.createElement("button");
  viewBtn.className = "ghost";
  viewBtn.textContent = "View";
  viewBtn.addEventListener("click", () => {
    const isHidden = packetPanel.classList.contains("is-hidden");
    if (isHidden) {
      packetPanel.classList.remove("is-hidden");
      viewBtn.textContent = "Hide";
      renderAdminOpenPacketDetail(packet, packetPanel);
    } else {
      packetPanel.classList.add("is-hidden");
      viewBtn.textContent = "View";
    }
  });
  actions.appendChild(viewBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "ghost";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    const label = `${school} - ${ensemble}`;
    if (!confirmUser(`Delete open packet for ${label}? This removes packet audio and sessions.`)) {
      return;
    }
    try {
      await deleteOpenPacket({ packetId: packet.id });
    } catch (error) {
      console.error("Delete open packet failed", error);
      alertUser("Unable to delete open packet. Check console for details.");
    }
  });
  actions.appendChild(deleteBtn);

  wrapper.appendChild(actions);
  wrapper.appendChild(packetPanel);
  return wrapper;
}

export function setStageJudgeSelectValues({
  stage1Uid = "",
  stage2Uid = "",
  stage3Uid = "",
  sightUid = "",
} = {}) {
  if (els.stage1JudgeSelect) els.stage1JudgeSelect.value = stage1Uid;
  if (els.stage2JudgeSelect) els.stage2JudgeSelect.value = stage2Uid;
  if (els.stage3JudgeSelect) els.stage3JudgeSelect.value = stage3Uid;
  if (els.sightJudgeSelect) els.sightJudgeSelect.value = sightUid;
}

export function renderDirectorEventOptions() {
  if (hasDirectorUnsavedChanges()) {
    return;
  }
  const events = state.event.list || [];
  const exists = events.some((event) => event.id === state.director.selectedEventId);
  if (!exists) {
    state.director.selectedEventId = state.event.active?.id || events[0]?.id || null;
  }
  if (els.directorEventSelect) {
    els.directorEventSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an event";
    els.directorEventSelect.appendChild(placeholder);
    events.forEach((event) => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = getEventCardLabel(event);
      els.directorEventSelect.appendChild(option);
    });
    if (state.director.selectedEventId) {
      els.directorEventSelect.value = state.director.selectedEventId;
    }
  }
  updateDirectorEventMeta();
  loadDirectorEntry({
    onUpdate: applyDirectorEntryUpdate,
    onClear: applyDirectorEntryClear,
  });
}

export function updateDirectorEventMeta() {
  if (!els.directorEventMeta) return;
  const event = state.event.list.find((item) => item.id === state.director.selectedEventId);
  if (!event) {
    if (els.directorEventName) {
      els.directorEventName.textContent = "No event selected.";
    } else {
      els.directorEventMeta.textContent = "No event selected.";
    }
    if (els.directorEventDetail) {
      els.directorEventDetail.textContent = "";
    }
    if (els.directorScheduleBtn) {
      els.directorScheduleBtn.disabled = true;
    }
    return;
  }
  const name = event.name || "Event";
  const startDate = event.startAt ? formatDateHeading(event.startAt) : "";
  const endDate = event.endAt ? formatDateHeading(event.endAt) : "";
  const dateLabel =
    startDate && endDate && startDate !== endDate
      ? `${startDate} â€“ ${endDate}`
      : startDate || endDate || "";
  if (els.directorEventName) {
    els.directorEventName.textContent = name;
  } else {
    els.directorEventMeta.textContent = name;
  }
  if (els.directorEventDetail) {
    els.directorEventDetail.textContent = dateLabel;
  }
  if (els.directorScheduleBtn) {
    els.directorScheduleBtn.disabled = false;
  }
}

export function updateRepertoirePreview(wrapper, key) {
  if (!wrapper || !state.director.entryDraft) return;
  const preview = wrapper.querySelector(`[data-preview-key="${key}"]`);
  if (!preview) return;
  const grade = state.director.entryDraft.repertoire?.[key]?.grade || "";
  const title = state.director.entryDraft.repertoire?.[key]?.title || "";
  const composer = state.director.entryDraft.repertoire?.[key]?.composer || "";
  const parts = [];
  if (grade) parts.push(grade);
  if (title) parts.push(title);
  if (composer) parts.push(`- ${composer}`);
  preview.textContent = parts.length ? `Selected: ${parts.join(" ")}` : "";
}

export function renderRepertoireFields() {
  if (!els.repertoireFields || !state.director.entryDraft) return;
  els.repertoireFields.innerHTML = "";
  if (!state.director.entryDraft.repertoire) {
    state.director.entryDraft.repertoire = {};
  }
  const repertoire = state.director.entryDraft.repertoire;
  if (!repertoire.repertoireRuleMode) {
    repertoire.repertoireRuleMode = "standard";
  }
  const flexCheckboxes = [];
  const syncRepertoireFlexCheckboxes = () => {
    const checked = Boolean(state.director.entryDraft?.performanceGradeFlex);
    flexCheckboxes.forEach((cb) => {
      cb.checked = checked;
    });
  };

  REPERTOIRE_FIELDS.forEach((piece) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
    if (!repertoire[piece.key]) {
      repertoire[piece.key] = {
        pieceId: null,
        grade: "",
        title: "",
        composer: "",
      };
    }
    const pieceData = repertoire[piece.key];
    if (piece.key === "march") {
      const titleLabel = document.createElement("label");
      titleLabel.textContent = `${piece.label} Title`;
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.placeholder = "Enter march title...";
      titleInput.value = pieceData?.title || "";
      titleLabel.appendChild(titleInput);
      wrapper.appendChild(titleLabel);

      const composerLabel = document.createElement("label");
      composerLabel.textContent = `${piece.label} Composer/Arranger`;
      const composerInput = document.createElement("input");
      composerInput.type = "text";
      composerInput.value = pieceData?.composer || "";
      composerLabel.appendChild(composerInput);
      wrapper.appendChild(composerLabel);

      titleInput.addEventListener("input", () => {
        pieceData.title = titleInput.value.trim();
        applyDirectorDirty("repertoire");
        updateRepertoirePreview(wrapper, piece.key);
      });
      composerInput.addEventListener("input", () => {
        pieceData.composer = composerInput.value.trim();
        applyDirectorDirty("repertoire");
        updateRepertoirePreview(wrapper, piece.key);
      });

      const preview = document.createElement("div");
      preview.className = "hint";
      preview.dataset.previewKey = piece.key;
      wrapper.appendChild(preview);
      updateRepertoirePreview(wrapper, piece.key);

      els.repertoireFields.appendChild(wrapper);
      return;
    }

    const row = document.createElement("div");
    row.className = "repertoire-row";

    const gradeLabel = document.createElement("label");
    gradeLabel.textContent = "Grade";
    const gradeSelect = document.createElement("select");
    gradeLabel.appendChild(gradeSelect);
    const baseOption = document.createElement("option");
    baseOption.value = "";
    baseOption.textContent = "Grade";
    gradeSelect.appendChild(baseOption);
    ["I", "II", "III", "IV", "V", "VI"].forEach((roman) => {
      const option = document.createElement("option");
      option.value = roman;
      option.textContent = roman;
      gradeSelect.appendChild(option);
    });
    gradeSelect.value = pieceData?.grade || "";

    const titleLabel = document.createElement("label");
    titleLabel.textContent = `${piece.label} Title`;
    const combo = document.createElement("div");
    combo.className = "mpa-combobox";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "Start typing a title...";
    titleInput.value = pieceData?.title || "";
    const list = document.createElement("div");
    list.className = "mpa-combobox-list";
    list.hidden = true;
    let suggestionRenderVersion = 0;
    const closeSuggestions = () => {
      suggestionRenderVersion += 1;
      list.hidden = true;
    };
    combo.appendChild(titleInput);
    combo.appendChild(list);
    titleLabel.appendChild(combo);

    row.appendChild(gradeLabel);
    row.appendChild(titleLabel);
    wrapper.appendChild(row);

    const composerRow = document.createElement("div");
    composerRow.className = "row repertoire-composer-row";
    const composerLabel = document.createElement("label");
    composerLabel.textContent = `${piece.label} Composer/Arranger`;
    const composerInput = document.createElement("input");
    composerInput.type = "text";
    composerInput.value = pieceData?.composer || "";
    composerInput.readOnly = Boolean(pieceData?.pieceId);
    composerLabel.appendChild(composerInput);
    const composerEditBtn = document.createElement("button");
    composerEditBtn.type = "button";
    composerEditBtn.className = "ghost btn--sm";
    composerEditBtn.textContent = "Edit";
    composerEditBtn.addEventListener("click", () => {
      composerInput.readOnly = !composerInput.readOnly;
      composerEditBtn.textContent = composerInput.readOnly ? "Edit" : "Lock";
      if (!composerInput.readOnly) {
        composerInput.focus();
      }
    });
    composerRow.appendChild(composerLabel);
    composerRow.appendChild(composerEditBtn);
    wrapper.appendChild(composerRow);

    if (piece.key === "selection1" || piece.key === "selection2") {
      const flexRow = document.createElement("label");
      flexRow.className = "director-flex-row";
      const flexCheckbox = document.createElement("input");
      flexCheckbox.type = "checkbox";
      flexCheckbox.checked = Boolean(state.director.entryDraft.performanceGradeFlex);
      flexCheckbox.addEventListener("change", () => {
        state.director.entryDraft.performanceGradeFlex = Boolean(flexCheckbox.checked);
        syncRepertoireFlexCheckboxes();
        setDirectorPerformanceGradeValue(state.director.entryDraft.performanceGrade || "");
        applyDirectorDirty("repertoire");
      });
      flexCheckboxes.push(flexCheckbox);
      const flexText = document.createElement("span");
      flexText.textContent = "Flex";
      flexRow.appendChild(flexCheckbox);
      flexRow.appendChild(flexText);
      wrapper.appendChild(flexRow);
    }

    if (piece.key === "selection2") {
      const masterworkWrap = document.createElement("label");
      masterworkWrap.className = "row";
      masterworkWrap.style.alignItems = "center";
      const masterworkCheckbox = document.createElement("input");
      masterworkCheckbox.type = "checkbox";
      masterworkCheckbox.checked = repertoire.repertoireRuleMode === "masterwork";
      masterworkCheckbox.addEventListener("change", () => {
        repertoire.repertoireRuleMode = masterworkCheckbox.checked ? "masterwork" : "standard";
        applyDirectorDirty("repertoire");
      });
      const masterworkText = document.createElement("span");
      masterworkText.textContent =
        "Masterwork Exception (Selection #2 optional if Selection #1 is a Masterwork)";
      masterworkWrap.appendChild(masterworkCheckbox);
      masterworkWrap.appendChild(masterworkText);
      wrapper.appendChild(masterworkWrap);
    }

    const preview = document.createElement("div");
    preview.className = "hint";
    preview.dataset.previewKey = piece.key;
    wrapper.appendChild(preview);
    updateRepertoirePreview(wrapper, piece.key);

    const updatePerformanceGrade = () => {
      const selection1Level = romanToLevel(
        state.director.entryDraft.repertoire?.selection1?.grade
      );
      const selection2Level = romanToLevel(
        state.director.entryDraft.repertoire?.selection2?.grade
      );
      const derived = derivePerformanceGrade(selection1Level, selection2Level);
      if (derived.ok) {
        state.director.entryDraft.performanceGrade = derived.value;
        if (els.directorPerformanceGradeInput) {
          els.directorPerformanceGradeInput.value = derived.value;
        }
        setPerformanceGradeError("");
      }
    };

    const renderSuggestions = async () => {
      const renderVersion = ++suggestionRenderVersion;
      list.innerHTML = "";
      const grade = pieceData.grade;
      if (!grade) {
        const empty = document.createElement("div");
        empty.className = "mpa-combobox-empty";
        empty.textContent = "Select a grade to browse titles.";
        list.appendChild(empty);
        list.hidden = false;
        return;
      }
      list.hidden = false;
      const loading = document.createElement("div");
      loading.className = "mpa-combobox-empty";
      loading.textContent = "Loading titles...";
      list.appendChild(loading);
      const options = await getMpaRepertoireForGrade(grade);
      if (renderVersion !== suggestionRenderVersion) return;
      const queryText = titleInput.value.trim().toLowerCase();
      const filtered = options.filter((item) => {
        const hay = item.titleLower || item.title.toLowerCase();
        return !queryText || hay.includes(queryText);
      });
      const top = filtered.slice(0, 20);
      list.innerHTML = "";
      if (!top.length) {
        const empty = document.createElement("div");
        empty.className = "mpa-combobox-empty";
        empty.textContent = "No matches found.";
        list.appendChild(empty);
        return;
      }
      top.forEach((item) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "mpa-combobox-option";
        const masterworkBadge = item.isMasterwork ? " [Masterwork]" : "";
        option.textContent = `${item.title}${item.composer ? ` - ${item.composer}` : ""}${masterworkBadge}`;
        option.addEventListener("click", () => {
          pieceData.pieceId = item.id;
          pieceData.grade = grade;
          pieceData.title = item.title || "";
          pieceData.composer = item.composer || "";
          titleInput.value = pieceData.title;
          composerInput.value = pieceData.composer;
          composerInput.readOnly = true;
          composerEditBtn.textContent = "Edit";
          closeSuggestions();
          applyDirectorDirty("repertoire");
          updatePerformanceGrade();
          updateRepertoirePreview(wrapper, piece.key);
        });
        list.appendChild(option);
      });
    };

    gradeSelect.addEventListener("change", async () => {
      const nextGrade = gradeSelect.value || "";
      if (pieceData.grade !== nextGrade) {
        pieceData.grade = nextGrade;
        pieceData.pieceId = null;
        pieceData.title = "";
        pieceData.composer = "";
        titleInput.value = "";
        composerInput.value = "";
        composerInput.readOnly = false;
        composerEditBtn.textContent = "Edit";
        closeSuggestions();
        list.innerHTML = "";
      }
      applyDirectorDirty("repertoire");
      updatePerformanceGrade();
      updateRepertoirePreview(wrapper, piece.key);
      if (nextGrade) {
        await getMpaRepertoireForGrade(nextGrade);
      }
    });

    titleInput.addEventListener("input", () => {
      pieceData.title = titleInput.value.trim();
      pieceData.pieceId = null;
      composerInput.readOnly = false;
      composerEditBtn.textContent = "Edit";
      applyDirectorDirty("repertoire");
      updateRepertoirePreview(wrapper, piece.key);
      renderSuggestions();
    });

    titleInput.addEventListener("focus", () => {
      renderSuggestions();
    });

    titleInput.addEventListener("blur", () => {
      window.setTimeout(() => {
        closeSuggestions();
      }, 120);
    });

    composerInput.addEventListener("input", () => {
      pieceData.composer = composerInput.value.trim();
      applyDirectorDirty("repertoire");
      updateRepertoirePreview(wrapper, piece.key);
    });

    const selectedMeta = document.createElement("div");
    selectedMeta.className = "hint";
    const updateSelectedMeta = async () => {
      const selection = state.director.entryDraft.repertoire?.[piece.key] || {};
      const grade = normalizeGrade(selection.grade);
      if (!selection.pieceId || !grade) {
        selectedMeta.textContent = "";
        return;
      }
      const options = await getMpaRepertoireForGrade(grade);
      const match = options.find((item) => item.id === selection.pieceId);
      if (!match) {
        selectedMeta.textContent = "";
        return;
      }
      const tags = [];
      if (match.isMasterwork || `${match.specialInstructions || ""} ${match.status || ""} ${(match.tags || []).join(" ")}`.toLowerCase().includes("masterwork")) {
        tags.push("Masterwork");
      }
      if (match.grade === "VI") {
        tags.push("Grade VI");
      }
      selectedMeta.textContent = tags.length ? `Tags: ${tags.join(" - ")}` : "";
    };
    wrapper.appendChild(selectedMeta);
    updateSelectedMeta();

    els.repertoireFields.appendChild(wrapper);
  });
  syncRepertoireFlexCheckboxes();
}

export function renderInstrumentationStandard() {
  if (!els.instrumentationStandard || !state.director.entryDraft) return;
  els.instrumentationStandard.innerHTML = "";
  STANDARD_INSTRUMENTS.forEach((instrument) => {
    const label = document.createElement("label");
    label.textContent = instrument.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.value = "0";
    label.appendChild(input);
    const current =
      state.director.entryDraft.instrumentation?.standardCounts?.[instrument.key] ?? 0;
    input.value = Number(current || 0);
    input.dataset.instrumentKey = instrument.key;
    input.addEventListener("change", () => {
      state.director.entryDraft.instrumentation.standardCounts[instrument.key] = Number(
        input.value || 0
      );
      applyDirectorDirty("instrumentation");
    });
    els.instrumentationStandard.appendChild(label);
  });
}

export function renderInstrumentationNonStandard() {
  if (!els.instrumentationNonStandard || !state.director.entryDraft) return;
  els.instrumentationNonStandard.innerHTML = "";
  state.director.entryDraft.instrumentation.nonStandard.forEach((row, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "entry-row";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Instrument";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameLabel.appendChild(nameInput);
    nameInput.value = row.instrumentName || "";
    nameInput.addEventListener("blur", () => {
      if (!state.director.entryDraft) return;
      state.director.entryDraft.instrumentation.nonStandard[index].instrumentName =
        nameInput.value.trim();
      applyDirectorDirty("instrumentation");
    });

    const countLabel = document.createElement("label");
    countLabel.textContent = "Count";
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "0";
    countInput.value = "0";
    countLabel.appendChild(countInput);
    countInput.value = Number(row.count || 0);
    countInput.addEventListener("change", () => {
      if (!state.director.entryDraft) return;
      state.director.entryDraft.instrumentation.nonStandard[index].count = Number(
        countInput.value || 0
      );
      applyDirectorDirty("instrumentation");
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      state.director.entryDraft.instrumentation.nonStandard.splice(index, 1);
      renderInstrumentationNonStandard();
      applyDirectorDirty("instrumentation");
    });

    wrapper.appendChild(nameLabel);
    wrapper.appendChild(countLabel);
    wrapper.appendChild(removeBtn);
    els.instrumentationNonStandard.appendChild(wrapper);
  });
}

export function renderRule3cRows() {
  if (!els.rule3cRows || !state.director.entryDraft) return;
  els.rule3cRows.innerHTML = "";
  const otherEnsembles = state.director.ensemblesCache.filter(
    (ensemble) => ensemble.id !== state.director.selectedEnsembleId
  );
  state.director.entryDraft.rule3c.entries.forEach((row, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "entry-row";
    const studentLabel = document.createElement("label");
    studentLabel.textContent = "Student Name/Identifier";
    const studentInput = document.createElement("input");
    studentInput.type = "text";
    studentLabel.appendChild(studentInput);
    studentInput.value = row.studentNameOrIdentifier || "";
    studentInput.addEventListener("blur", () => {
      state.director.entryDraft.rule3c.entries[index].studentNameOrIdentifier =
        studentInput.value.trim();
      applyDirectorDirty("rule3c");
    });

    const instrumentLabel = document.createElement("label");
    instrumentLabel.textContent = "Instrument";
    const instrumentInput = document.createElement("input");
    instrumentInput.type = "text";
    instrumentLabel.appendChild(instrumentInput);
    instrumentInput.value = row.instrument || "";
    instrumentInput.addEventListener("blur", () => {
      state.director.entryDraft.rule3c.entries[index].instrument =
        instrumentInput.value.trim();
      applyDirectorDirty("rule3c");
    });

    const ensembleLabel = document.createElement("label");
    ensembleLabel.textContent = "Also doubles in ensemble";
    const ensembleSelect = document.createElement("select");
    ensembleLabel.appendChild(ensembleSelect);
    const baseOption = document.createElement("option");
    baseOption.value = "";
    baseOption.textContent = "Select ensemble";
    ensembleSelect.appendChild(baseOption);
    otherEnsembles.forEach((ensemble) => {
      const option = document.createElement("option");
      option.value = ensemble.id;
      option.textContent = ensemble.name || ensemble.id;
      ensembleSelect.appendChild(option);
    });
    ensembleSelect.value = row.alsoDoublesInEnsembleId || "";
    ensembleSelect.addEventListener("change", () => {
      state.director.entryDraft.rule3c.entries[index].alsoDoublesInEnsembleId =
        ensembleSelect.value;
      applyDirectorDirty("rule3c");
    });

    wrapper.appendChild(studentLabel);
    wrapper.appendChild(instrumentLabel);
    wrapper.appendChild(ensembleLabel);
    els.rule3cRows.appendChild(wrapper);
  });
}

export function renderSeatingRows() {
  if (!els.seatingRows || !state.director.entryDraft) return;
  els.seatingRows.innerHTML = "";
  state.director.entryDraft.seating.rows.forEach((row, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "entry-row";
    const chairsLabel = document.createElement("label");
    chairsLabel.textContent = `Chairs (Row ${index + 1})`;
    const chairsInput = document.createElement("input");
    chairsInput.type = "number";
    chairsInput.min = "0";
    chairsInput.value = "0";
    chairsLabel.appendChild(chairsInput);
    chairsInput.value = Number(row.chairs || 0);
    chairsInput.addEventListener("change", () => {
      state.director.entryDraft.seating.rows[index].chairs = Number(
        chairsInput.value || 0
      );
      applyDirectorDirty("seating");
    });

    const standsLabel = document.createElement("label");
    standsLabel.textContent = `Stands (Row ${index + 1})`;
    const standsInput = document.createElement("input");
    standsInput.type = "number";
    standsInput.min = "0";
    standsInput.value = "0";
    standsLabel.appendChild(standsInput);
    standsInput.value = Number(row.stands || 0);
    standsInput.addEventListener("change", () => {
      state.director.entryDraft.seating.rows[index].stands = Number(
        standsInput.value || 0
      );
      applyDirectorDirty("seating");
    });

    wrapper.appendChild(chairsLabel);
    wrapper.appendChild(standsLabel);
    els.seatingRows.appendChild(wrapper);
  });
}

export function renderPercussionOptions() {
  if (!els.percussionOptions || !state.director.entryDraft) return;
  els.percussionOptions.innerHTML = "";
  const selected = new Set(state.director.entryDraft.percussionNeeds.selected || []);
  PERCUSSION_OPTIONS.forEach((item) => {
    const label = document.createElement("label");
    label.className = "row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(item);
    checkbox.addEventListener("change", () => {
      if (!state.director.entryDraft) return;
      const current = new Set(state.director.entryDraft.percussionNeeds.selected || []);
      if (checkbox.checked) {
        current.add(item);
      } else {
        current.delete(item);
      }
      state.director.entryDraft.percussionNeeds.selected = Array.from(current);
      applyDirectorDirty("percussion");
    });
    const text = document.createElement("span");
    text.textContent = item;
    label.appendChild(checkbox);
    label.appendChild(text);
    els.percussionOptions.appendChild(label);
  });
}

export function renderDirectorEntryForm() {
  if (!state.director.entryDraft) {
    if (els.directorEntryForm) els.directorEntryForm.reset?.();
    return;
  }
  if (els.directorPerformanceGradeInput) {
    setDirectorPerformanceGradeValue(state.director.entryDraft.performanceGrade || "");
    els.directorPerformanceGradeInput.oninput = null;
  }
  if (els.directorPerformanceGradeFlex) {
    els.directorPerformanceGradeFlex.checked = Boolean(
      state.director.entryDraft.performanceGradeFlex
    );
    els.directorPerformanceGradeFlex.onchange = () => {
      state.director.entryDraft.performanceGradeFlex =
        els.directorPerformanceGradeFlex.checked;
      setDirectorPerformanceGradeValue(state.director.entryDraft.performanceGrade || "");
      applyDirectorDirty("repertoire");
    };
  }
  if (els.instrumentationTotalPercussion) {
    els.instrumentationTotalPercussion.value = Number(
      state.director.entryDraft.instrumentation?.totalPercussion || 0
    );
    els.instrumentationTotalPercussion.onchange = () => {
      state.director.entryDraft.instrumentation.totalPercussion = Number(
        els.instrumentationTotalPercussion.value || 0
      );
      applyDirectorDirty("instrumentation");
    };
  }
  if (els.otherInstrumentationNotesInput) {
    els.otherInstrumentationNotesInput.value =
      state.director.entryDraft.instrumentation?.otherInstrumentationNotes || "";
    els.otherInstrumentationNotesInput.oninput = () => {
      state.director.entryDraft.instrumentation.otherInstrumentationNotes =
        els.otherInstrumentationNotesInput.value || "";
      applyDirectorDirty("instrumentation");
    };
  }
  if (els.rule3cNotesInput) {
    els.rule3cNotesInput.value = state.director.entryDraft.rule3c?.notes || "";
    els.rule3cNotesInput.oninput = () => {
      state.director.entryDraft.rule3c.notes = els.rule3cNotesInput.value || "";
      applyDirectorDirty("rule3c");
    };
  }
  if (els.seatingNotesInput) {
    els.seatingNotesInput.value = state.director.entryDraft.seating?.notes || "";
    els.seatingNotesInput.oninput = () => {
      state.director.entryDraft.seating.notes = els.seatingNotesInput.value || "";
      applyDirectorDirty("seating");
    };
  }
  if (els.percussionNotesInput) {
    els.percussionNotesInput.value =
      state.director.entryDraft.percussionNeeds?.notes || "";
    els.percussionNotesInput.oninput = () => {
      state.director.entryDraft.percussionNeeds.notes =
        els.percussionNotesInput.value || "";
      applyDirectorDirty("percussion");
    };
  }
  if (els.lunchPepperoniInput) {
    els.lunchPepperoniInput.value = Number(
      state.director.entryDraft.lunchOrder?.pepperoniQty || 0
    );
    els.lunchPepperoniInput.onchange = () => {
      state.director.entryDraft.lunchOrder.pepperoniQty = Number(
        els.lunchPepperoniInput.value || 0
      );
      applyDirectorDirty("lunch");
      updateLunchTotalCost();
    };
  }
  if (els.lunchCheeseInput) {
    els.lunchCheeseInput.value = Number(
      state.director.entryDraft.lunchOrder?.cheeseQty || 0
    );
    els.lunchCheeseInput.onchange = () => {
      state.director.entryDraft.lunchOrder.cheeseQty = Number(
        els.lunchCheeseInput.value || 0
      );
      applyDirectorDirty("lunch");
      updateLunchTotalCost();
    };
  }
  
  updateLunchTotalCost();

  renderRepertoireFields();
  renderInstrumentationStandard();
  renderInstrumentationNonStandard();
  renderRule3cRows();
  renderSeatingRows();
  renderPercussionOptions();
}

export function setDirectorEntryHint(message) {
  if (!els.directorEntryHint) return;
  els.directorEntryHint.textContent = message || "";
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
  const resolvedRoot = root || (rootId ? document.getElementById(rootId) : null);
  if (!resolvedRoot) return;
  const titleEl = resolvedRoot.querySelector(".readiness-title");
  const metaEl = resolvedRoot.querySelector(".readiness-meta");
  const barEl = resolvedRoot.querySelector(".progress-bar");
  const pillEl = resolvedRoot.querySelector(".pill");
  const detailsEl = resolvedRoot.querySelector("details");
  const hintEl = resolvedRoot.querySelector(".readiness-hint");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (titleEl) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = `${done}/${total} complete`;
  if (barEl) barEl.style.width = `${pct}%`;
  if (pillEl) pillEl.textContent = pillText;
  if (hintEl) hintEl.textContent = hintText;
  if (detailsEl && openWhenIncomplete) detailsEl.open = done !== total;
}

export function renderChecklist(listEl, items, status) {
  if (!listEl) return;
  listEl.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "checklist-item";

    const label = document.createElement("span");
    label.textContent = item.label;

    const check = document.createElement("span");
    const ok = Boolean(status[item.key]);
    check.textContent = ok ? "" : "Missing";
    check.className = ok ? "check" : "check is-missing";

    li.appendChild(label);
    li.appendChild(check);
    listEl.appendChild(li);
  });
}

export function renderDirectorChecklist(entry, completionState) {
  if (!els.directorChecklist) return;
  const s = completionState || {};
  const items = [
    { key: "ensemble", label: "Ensemble" },
    { key: "repertoire", label: "Repertoire" },
    { key: "instrumentation", label: "Instrumentation" },
    { key: "grade", label: "Grade ready" },
  ];

  const total = items.length;
  const done = items.filter((item) => Boolean(s[item.key])).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    renderStatusSummary({
      rootId: "directorChecklistPanel",
      title: done === total ? "Ready to submit" : "Not ready yet",
      done,
      total,
      pillText: done === total ? "Complete" : "Incomplete",
      hintText: done === total ? "" : `${total - done} missing`,
    });

    if (els.directorSummaryStatus) {
      els.directorSummaryStatus.textContent = done === total ? "Ready" : "Incomplete";
    }
  if (els.directorSummaryCompletion) {
    els.directorSummaryCompletion.textContent = `${pct}%`;
  }
  if (els.directorSummaryProgressBar) {
    els.directorSummaryProgressBar.style.width = `${pct}%`;
  }

  renderChecklist(els.directorChecklist, items, s);
}

export function renderAdminReadiness() {
  if (!els.adminReadinessChecklist) return;
  const hasEvent = Boolean(state.event.active);
  const assignments = state.event.assignments || {};
  const hasAssignments =
    hasEvent &&
    Boolean(assignments.stage1Uid) &&
    Boolean(assignments.stage2Uid) &&
    Boolean(assignments.stage3Uid) &&
    Boolean(assignments.sightUid);
  const items = [
    { key: "event", label: "Active event" },
    { key: "assignments", label: "Judge assignments" },
  ];
  const status = {
    event: hasEvent,
    assignments: hasAssignments,
  };
  const total = items.length;
  const done = items.filter((item) => Boolean(status[item.key])).length;

  renderStatusSummary({
    rootId: "adminReadinessPanel",
    title: done === total ? "Ready to run event" : "Setup in progress",
    done,
    total,
    pillText: done === total ? "Complete" : "Draft",
    hintText: done === total ? "" : `${total - done} missing`,
  });

  renderChecklist(els.adminReadinessChecklist, items, status);
}

export function updateDirectorActiveEnsembleLabel() {
  if (!els.directorActiveEnsemblePill) return;
  if (!state.director.selectedEnsembleId && state.director.ensemblesCache.length) {
    state.director.selectedEnsembleId = state.director.ensemblesCache[0].id;
  }
  const active = state.director.ensemblesCache.find(
    (ensemble) => ensemble.id === state.director.selectedEnsembleId
  );
  if (active?.name) {
    if (els.directorActiveEnsemblePill) {
      els.directorActiveEnsemblePill.textContent = active.name;
      els.directorActiveEnsemblePill.classList.remove("is-hidden");
    }
    if (els.directorEditActiveEnsembleBtn) {
      els.directorEditActiveEnsembleBtn.classList.remove("is-hidden");
    }
  } else {
    if (els.directorActiveEnsemblePill) {
      els.directorActiveEnsemblePill.textContent = "None selected";
      els.directorActiveEnsemblePill.classList.add("is-hidden");
    }
    if (els.directorEditActiveEnsembleBtn) {
      els.directorEditActiveEnsembleBtn.classList.add("is-hidden");
    }
  }
}

function renderAdminLogisticsEnsembleOptions(select, ensembles = []) {
  if (!select) return;
  const previous = select.value || "";
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = ensembles.length ? "Select an ensemble" : "No ensembles available";
  select.appendChild(placeholder);
  ensembles.forEach((ensemble) => {
    const option = document.createElement("option");
    option.value = ensemble.id;
    option.textContent = ensemble.name || ensemble.id;
    select.appendChild(option);
  });
  if (previous && ensembles.some((ensemble) => ensemble.id === previous)) {
    select.value = previous;
  }
}

function setAdminLogisticsStatus(message) {
  if (!els.adminLogisticsStatus) return;
  els.adminLogisticsStatus.textContent = message || "";
}

function clearAdminLogisticsContent() {
  if (!els.adminLogisticsContent) return;
  els.adminLogisticsContent.innerHTML = "";
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

async function fetchAdminLogisticsEnsembles(schoolId) {
  if (!schoolId) return [];
  if (state.admin.logisticsEnsemblesCache.has(schoolId)) {
    return state.admin.logisticsEnsemblesCache.get(schoolId);
  }
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.schools, schoolId, COLLECTIONS.ensembles), orderBy("name"))
  );
  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  state.admin.logisticsEnsemblesCache.set(schoolId, items);
  return items;
}

async function loadAdminLogisticsEntry(eventId, ensembleId) {
  if (!eventId || !ensembleId) return null;
  if (state.admin.logisticsEntriesCacheEventId !== eventId) {
    state.admin.logisticsEntriesCacheEventId = eventId;
    state.admin.logisticsEntriesCache.clear();
  }
  const cacheKey = `${eventId}:${ensembleId}`;
  const cached = state.admin.logisticsEntriesCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < 15000) {
    return cached.value;
  }
  const snap = await getDoc(doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId));
  const value = snap.exists() ? (snap.data() || {}) : null;
  state.admin.logisticsEntriesCache.set(cacheKey, { cachedAt: now, value });
  return value;
}

async function refreshAdminLogisticsEntry() {
  if (!els.adminLogisticsStatus || !els.adminLogisticsContent) return;
  if (!state.event.active?.id) {
    setAdminLogisticsStatus("Set an active event first.");
    clearAdminLogisticsContent();
    return;
  }
  const currentSchoolId = els.adminLogisticsCurrentSchoolSelect?.value || "";
  const currentEnsembleId = els.adminLogisticsCurrentEnsembleSelect?.value || "";
  const nextSchoolId = els.adminLogisticsNextSchoolSelect?.value || "";
  const nextEnsembleId = els.adminLogisticsNextEnsembleSelect?.value || "";
  if (!currentSchoolId || !nextSchoolId) {
    setAdminLogisticsStatus("Choose schools for Band On Stage and Next Band.");
    clearAdminLogisticsContent();
    return;
  }
  if (!currentEnsembleId || !nextEnsembleId) {
    setAdminLogisticsStatus("Choose ensembles for Band On Stage and Next Band.");
    clearAdminLogisticsContent();
    return;
  }
  setAdminLogisticsStatus("Loading logistics from Director entry...");
  const loadVersion = (state.admin.logisticsLoadVersion || 0) + 1;
  state.admin.logisticsLoadVersion = loadVersion;
  try {
    const [currentEntry, nextEntry] = await Promise.all([
      loadAdminLogisticsEntry(state.event.active.id, currentEnsembleId),
      loadAdminLogisticsEntry(state.event.active.id, nextEnsembleId),
    ]);
    if (state.admin.logisticsLoadVersion !== loadVersion) return;
    if (!currentEntry || !nextEntry) {
      const missing = [];
      if (!currentEntry) missing.push("Band On Stage");
      if (!nextEntry) missing.push("Next Band");
      setAdminLogisticsStatus(
        `No Director entry found for ${missing.join(" and ")} in the active event.`
      );
      clearAdminLogisticsContent();
      return;
    }
    clearAdminLogisticsContent();
    els.adminLogisticsContent.appendChild(buildAdminLogisticsEntryPanel(currentEntry, "Band On Stage"));
    els.adminLogisticsContent.appendChild(buildAdminLogisticsEntryPanel(nextEntry, "Next Band"));
    els.adminLogisticsContent.appendChild(buildAdminLogisticsDiffPanel(currentEntry, nextEntry));
    setAdminLogisticsStatus(`Loaded from ${state.event.active.name || state.event.active.id}.`);
  } catch (error) {
    console.error("refreshAdminLogisticsEntry failed", error);
    if (state.admin.logisticsLoadVersion !== loadVersion) return;
    setAdminLogisticsStatus("Unable to load logistics.");
    clearAdminLogisticsContent();
  }
}

function normalizeAdminDutiesValue(adminDuties = {}) {
  const payment = adminDuties?.payment || {};
  const method = payment.method === "check" || payment.method === "cash" ? payment.method : "";
  const parsedAmount = Number(payment.amount);
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  return {
    signatureFormReceived: Boolean(adminDuties?.signatureFormReceived),
    feeReceived: Boolean(adminDuties?.feeReceived),
    payment: {
      method,
      amount,
      checkNumber: String(payment.checkNumber || "").trim(),
    },
    adminNote: String(adminDuties?.adminNote || ""),
  };
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "N/A";
  return `$${amount.toFixed(2)}`;
}

function setAdminDutiesStatus(message) {
  if (!els.adminDutiesStatus) return;
  els.adminDutiesStatus.textContent = message || "";
}

function setAdminDutiesOverviewStatus(message) {
  if (!els.adminDutiesOverviewStatus) return;
  els.adminDutiesOverviewStatus.textContent = message || "";
}

function setAdminDutiesSummary(message) {
  if (!els.adminDutiesSummary) return;
  els.adminDutiesSummary.textContent = message || "";
}

function clearAdminDutiesOverviewList() {
  if (!els.adminDutiesOverviewList) return;
  els.adminDutiesOverviewList.innerHTML = "";
}

function clearAdminDutiesList() {
  if (!els.adminDutiesList) return;
  els.adminDutiesList.innerHTML = "";
}

function renderDirectorAdminDutiesSummary(entry) {
  if (!els.directorAdminDutiesStatus) return;
  const duties = normalizeAdminDutiesValue(entry?.adminDuties || {});
  const hasAnyValue =
    duties.signatureFormReceived ||
    duties.feeReceived ||
    Boolean(duties.payment.method) ||
    duties.payment.amount != null ||
    Boolean(duties.adminNote);
  if (!entry || !hasAnyValue) {
    els.directorAdminDutiesStatus.textContent = "Admin Checkoffs: Not recorded yet";
    return;
  }
  const signatureLabel = duties.signatureFormReceived ? "Received" : "Not Received";
  const feeLabel = duties.feeReceived ? "Received" : "Not Received";
  let feeDetail = feeLabel;
  if (duties.feeReceived) {
    const methodLabel = duties.payment.method === "check" ? "Check" : duties.payment.method === "cash" ? "Cash" : "";
    const amountLabel = duties.payment.amount != null ? formatCurrency(duties.payment.amount) : "";
    feeDetail = [feeLabel, methodLabel, amountLabel].filter(Boolean).join(" • ");
  }
  els.directorAdminDutiesStatus.textContent = `Admin Checkoffs: Signature ${signatureLabel} | Fee ${feeDetail}`;
}

function renderAdminDutiesRows() {
  if (!els.adminDutiesList) return;
  if (!state.event.active?.id || !state.admin.dutiesSelectedSchoolId) {
    setAdminDutiesSummary("");
    return;
  }
  clearAdminDutiesList();
  const search = (state.admin.dutiesSearchQuery || "").trim().toLowerCase();
  const rows = (state.admin.dutiesRows || []).filter((row) => {
    if (!search) return true;
    return (row.ensembleName || row.ensembleId || "").toLowerCase().includes(search);
  });
  const summaryCounts = rows.reduce(
    (acc, row) => {
      const duties = normalizeAdminDutiesValue(row.adminDuties || {});
      const hasForm = Boolean(duties.signatureFormReceived);
      const hasFee = Boolean(duties.feeReceived);
      if (hasForm && hasFee) acc.complete += 1;
      else if (!hasForm && !hasFee) acc.missingBoth += 1;
      else if (!hasForm) acc.missingForm += 1;
      else if (!hasFee) acc.missingFee += 1;
      return acc;
    },
    { complete: 0, missingForm: 0, missingFee: 0, missingBoth: 0 }
  );
  setAdminDutiesSummary(
    rows.length
      ? `At a glance — Complete: ${summaryCounts.complete} | Missing form: ${summaryCounts.missingForm} | Missing fee: ${summaryCounts.missingFee} | Missing both: ${summaryCounts.missingBoth}`
      : ""
  );
  if (!rows.length) {
    setAdminDutiesStatus(search ? "No ensembles match your search." : "No ensembles found for this school.");
    return;
  }

  const scheduledKeys = new Set(
    (state.event.rosterEntries || []).map((entry) => `${entry.schoolId || ""}::${entry.ensembleId || ""}`)
  );
  setAdminDutiesStatus(
    `${rows.length} ensemble${rows.length === 1 ? "" : "s"} shown for ${state.event.active?.name || "active event"}.`
  );

  rows.forEach((row) => {
    const duties = normalizeAdminDutiesValue(row.adminDuties || {});
    const wrapper = document.createElement("div");
    wrapper.className = "panel stack";

    const titleRow = document.createElement("div");
    titleRow.className = "row";
    const title = document.createElement("strong");
    title.textContent = row.ensembleName || row.ensembleId || "Unknown ensemble";
    const scheduled = document.createElement("span");
    scheduled.className = "note";
    scheduled.textContent = `Scheduled: ${
      scheduledKeys.has(`${row.schoolId || ""}::${row.ensembleId || ""}`) ? "Yes" : "No"
    }`;
    titleRow.appendChild(title);
    titleRow.appendChild(scheduled);
    wrapper.appendChild(titleRow);

    const meta = document.createElement("div");
    meta.className = "note";
    meta.textContent = `School: ${row.schoolName || row.schoolId || "Unknown"}`;
    wrapper.appendChild(meta);

    const hasForm = Boolean(duties.signatureFormReceived);
    const hasFee = Boolean(duties.feeReceived);
    const statusLine = document.createElement("div");
    statusLine.className = "note";
    const overallStatus = hasForm && hasFee ? "Complete" : "Needs Follow-up";
    statusLine.textContent =
      `Status: ${overallStatus} | Form: ${hasForm ? "Received" : "Missing"} | Fee: ${hasFee ? "Paid" : "Missing"}`;
    wrapper.appendChild(statusLine);

    const signatureRow = document.createElement("label");
    signatureRow.className = "row";
    const signatureCheckbox = document.createElement("input");
    signatureCheckbox.type = "checkbox";
    signatureCheckbox.checked = Boolean(duties.signatureFormReceived);
    signatureRow.appendChild(signatureCheckbox);
    signatureRow.appendChild(document.createTextNode(" Signature Form received"));
    wrapper.appendChild(signatureRow);

    const feeRow = document.createElement("label");
    feeRow.className = "row";
    const feeCheckbox = document.createElement("input");
    feeCheckbox.type = "checkbox";
    feeCheckbox.checked = Boolean(duties.feeReceived);
    feeRow.appendChild(feeCheckbox);
    feeRow.appendChild(document.createTextNode(" Fee received"));
    wrapper.appendChild(feeRow);

    const paymentRow = document.createElement("div");
    paymentRow.className = "row";

    const methodLabel = document.createElement("label");
    methodLabel.className = "grow";
    methodLabel.textContent = "Method";
    const methodSelect = document.createElement("select");
    [
      { value: "", label: "Select method" },
      { value: "check", label: "Check" },
      { value: "cash", label: "Cash" },
    ].forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      methodSelect.appendChild(option);
    });
    methodSelect.value = duties.payment.method || "";
    methodLabel.appendChild(methodSelect);

    const amountLabel = document.createElement("label");
    amountLabel.className = "grow";
    amountLabel.textContent = "Amount";
    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.min = "0.01";
    amountInput.step = "0.01";
    amountInput.placeholder = "0.00";
    amountInput.value = duties.payment.amount != null ? String(duties.payment.amount) : "";
    amountLabel.appendChild(amountInput);

    const checkLabel = document.createElement("label");
    checkLabel.className = "grow";
    checkLabel.textContent = "Check Number";
    const checkInput = document.createElement("input");
    checkInput.type = "text";
    checkInput.placeholder = "Check #";
    checkInput.value = duties.payment.checkNumber || "";
    checkLabel.appendChild(checkInput);

    paymentRow.appendChild(methodLabel);
    paymentRow.appendChild(amountLabel);
    paymentRow.appendChild(checkLabel);
    wrapper.appendChild(paymentRow);

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Admin Note (internal)";
    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.placeholder = "Optional note";
    noteInput.value = duties.adminNote || "";
    noteLabel.appendChild(noteInput);
    wrapper.appendChild(noteLabel);

    const rowStatus = document.createElement("div");
    rowStatus.className = "note";
    wrapper.appendChild(rowStatus);

    const syncPaymentControls = () => {
      const feeReceived = Boolean(feeCheckbox.checked);
      const method = methodSelect.value || "";
      methodSelect.disabled = !feeReceived;
      amountInput.disabled = !feeReceived;
      checkInput.disabled = !feeReceived || method !== "check";
      checkLabel.style.display = !feeReceived || method !== "check" ? "none" : "";
      paymentRow.style.opacity = feeReceived ? "1" : "0.7";
    };
    syncPaymentControls();
    feeCheckbox.addEventListener("change", () => {
      if (!feeCheckbox.checked) {
        methodSelect.value = "";
        amountInput.value = "";
        checkInput.value = "";
      }
      syncPaymentControls();
    });
    methodSelect.addEventListener("change", () => {
      if (methodSelect.value !== "check") {
        checkInput.value = "";
      }
      syncPaymentControls();
    });

    const actions = document.createElement("div");
    actions.className = "actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      if (!state.event.active?.id) {
        showStatusMessage(rowStatus, "No active event selected.", "error");
        return;
      }
      const signatureFormReceived = Boolean(signatureCheckbox.checked);
      const feeReceived = Boolean(feeCheckbox.checked);
      const paymentMethod = (methodSelect.value || "").trim();
      const rawAmount = (amountInput.value || "").trim();
      const amountValue = rawAmount ? Number(rawAmount) : null;
      const checkNumber = (checkInput.value || "").trim();
      const adminNote = (noteInput.value || "").trim();

      if (feeReceived) {
        if (paymentMethod !== "check" && paymentMethod !== "cash") {
          showStatusMessage(rowStatus, "Choose payment method.", "error");
          return;
        }
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
          showStatusMessage(rowStatus, "Enter a fee amount greater than 0.", "error");
          return;
        }
        if (paymentMethod === "check" && !checkNumber) {
          showStatusMessage(rowStatus, "Enter check number for check payment.", "error");
          return;
        }
      }

      const payload = normalizeAdminDutiesValue({
        signatureFormReceived,
        feeReceived,
        payment: feeReceived
          ? {
              method: paymentMethod,
              amount: amountValue,
              checkNumber: paymentMethod === "check" ? checkNumber : "",
            }
          : {
              method: "",
              amount: null,
              checkNumber: "",
            },
        adminNote,
      });

      try {
        saveBtn.disabled = true;
        await saveAdminDutiesForEnsemble({
          eventId: state.event.active.id,
          schoolId: row.schoolId,
          ensembleId: row.ensembleId,
          adminDuties: payload,
        });
        row.adminDuties = payload;
        state.admin.dutiesEntriesByEnsembleId.set(row.ensembleId, {
          id: row.ensembleId,
          eventId: state.event.active.id,
          schoolId: row.schoolId,
          ensembleId: row.ensembleId,
          adminDuties: payload,
        });
        row.isAdminDutiesComplete = Boolean(payload.signatureFormReceived) && Boolean(payload.feeReceived);
        showStatusMessage(rowStatus, "Saved.");
        renderAdminDutiesRows();
        refreshAdminDutiesOverview();
      } catch (error) {
        console.error("Save admin duties failed", error);
        showStatusMessage(rowStatus, error?.message || "Unable to save.", "error");
      } finally {
        saveBtn.disabled = false;
      }
    });
    actions.appendChild(saveBtn);
    wrapper.appendChild(actions);

    els.adminDutiesList.appendChild(wrapper);
  });
}

async function refreshAdminDutiesOverview() {
  if (!els.adminDutiesOverviewList || !els.adminDutiesOverviewStatus) return;
  if (!state.event.active?.id) {
    clearAdminDutiesOverviewList();
    setAdminDutiesOverviewStatus("Set an active event to load the overview.");
    return;
  }
  const schools = [...(state.admin.schoolsList || [])].sort((a, b) =>
    String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""))
  );
  if (!schools.length) {
    clearAdminDutiesOverviewList();
    setAdminDutiesOverviewStatus("No schools available.");
    return;
  }

  const loadVersion = (state.admin.dutiesOverviewLoadVersion || 0) + 1;
  state.admin.dutiesOverviewLoadVersion = loadVersion;
  clearAdminDutiesOverviewList();
  setAdminDutiesOverviewStatus("Loading all schools overview...");

  try {
    const eventId = state.event.active.id;
    const [entryDocs, ensemblesBySchool] = await Promise.all([
      loadAdminDutiesEntriesForEvent({ eventId }),
      Promise.all(
        schools.map(async (school) => ({
          schoolId: school.id,
          ensembles: await fetchAdminLogisticsEnsembles(school.id),
        }))
      ),
    ]);
    if (state.admin.dutiesOverviewLoadVersion !== loadVersion) return;

    const entryByKey = new Map();
    entryDocs.forEach((entryDoc) => {
      const schoolId = entryDoc.schoolId || "";
      const ensembleId = entryDoc.ensembleId || entryDoc.id || "";
      if (!schoolId || !ensembleId) return;
      entryByKey.set(`${schoolId}::${ensembleId}`, entryDoc);
    });

    let totalSchools = schools.length;
    let schoolsWithNoEnsembles = 0;
    let schoolsFormComplete = 0;
    let schoolsFeeComplete = 0;

    const tableWrap = document.createElement("div");
    tableWrap.style.overflow = "auto";
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["School", "Form Submitted", "Fee Submitted"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      th.style.textAlign = "left";
      th.style.padding = "4px 6px";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    ensemblesBySchool.forEach(({ schoolId, ensembles }) => {
      const school = schools.find((item) => item.id === schoolId) || { id: schoolId, name: schoolId };
      const tr = document.createElement("tr");
      const schoolCell = document.createElement("td");
      schoolCell.style.padding = "4px 6px";
      const schoolLabel = school.name || school.id || "Unknown school";

      let formSubmitted = false;
      let feeSubmitted = false;
      if (!Array.isArray(ensembles) || !ensembles.length) {
        schoolsWithNoEnsembles += 1;
        schoolCell.textContent = `${schoolLabel} (No Ensembles)`;
      } else {
        let formAllComplete = true;
        let feeAllComplete = true;
        ensembles.forEach((ensemble) => {
          const key = `${schoolId}::${ensemble.id}`;
          const entryDoc = entryByKey.get(key) || null;
          const duties = normalizeAdminDutiesValue(entryDoc?.adminDuties || {});
          if (!duties.signatureFormReceived) formAllComplete = false;
          if (!duties.feeReceived) feeAllComplete = false;
        });
        formSubmitted = formAllComplete;
        feeSubmitted = feeAllComplete;
        if (formSubmitted) schoolsFormComplete += 1;
        if (feeSubmitted) schoolsFeeComplete += 1;
        schoolCell.textContent = schoolLabel;
      }

      const formCell = document.createElement("td");
      formCell.style.padding = "4px 6px";
      formCell.textContent = formSubmitted ? "Yes" : "No";
      const feeCell = document.createElement("td");
      feeCell.style.padding = "4px 6px";
      feeCell.textContent = feeSubmitted ? "Yes" : "No";

      tr.appendChild(schoolCell);
      tr.appendChild(formCell);
      tr.appendChild(feeCell);
      tbody.appendChild(tr);
    });
    tableWrap.appendChild(table);
    els.adminDutiesOverviewList.appendChild(tableWrap);

    setAdminDutiesOverviewStatus(
      `${totalSchools} schools | Form complete: ${schoolsFormComplete} | Fee complete: ${schoolsFeeComplete} | No ensembles: ${schoolsWithNoEnsembles}`
    );
  } catch (error) {
    console.error("refreshAdminDutiesOverview failed", error);
    if (state.admin.dutiesOverviewLoadVersion !== loadVersion) return;
    clearAdminDutiesOverviewList();
    setAdminDutiesOverviewStatus("Unable to load all schools overview.");
  }
}

async function refreshAdminDutiesPanel() {
  if (!els.adminDutiesList || !els.adminDutiesStatus) return;
  if (!state.event.active?.id) {
    state.admin.dutiesRows = [];
    state.admin.dutiesEntriesByEnsembleId.clear();
    clearAdminDutiesList();
    setAdminDutiesSummary("");
    setAdminDutiesStatus("Set an active event, then choose a school.");
    return;
  }
  const schoolId = els.adminDutiesSchoolSelect?.value || "";
  state.admin.dutiesSelectedSchoolId = schoolId;
  if (!schoolId) {
    state.admin.dutiesRows = [];
    state.admin.dutiesEntriesByEnsembleId.clear();
    clearAdminDutiesList();
    setAdminDutiesSummary("");
    setAdminDutiesStatus("Choose a school to track ensemble checkoffs.");
    return;
  }
  const loadVersion = (state.admin.dutiesLoadVersion || 0) + 1;
  state.admin.dutiesLoadVersion = loadVersion;
  clearAdminDutiesList();
  setAdminDutiesStatus("Loading ensemble admin checkoffs...");
  try {
    const [ensembles, entries] = await Promise.all([
      fetchAdminLogisticsEnsembles(schoolId),
      loadAdminDutiesEntriesForSchool({ eventId: state.event.active.id, schoolId }),
    ]);
    if (state.admin.dutiesLoadVersion !== loadVersion) return;
    state.admin.dutiesEntriesByEnsembleId.clear();
    entries.forEach((entryDoc) => {
      state.admin.dutiesEntriesByEnsembleId.set(entryDoc.id || entryDoc.ensembleId, entryDoc);
    });
    const schoolName = state.admin.schoolsList.find((school) => school.id === schoolId)?.name || schoolId;
    state.admin.dutiesRows = (ensembles || [])
      .map((ensemble) => {
        const entryDoc = state.admin.dutiesEntriesByEnsembleId.get(ensemble.id) || null;
        const normalizedDuties = normalizeAdminDutiesValue(entryDoc?.adminDuties || {});
        const isComplete =
          Boolean(normalizedDuties.signatureFormReceived) && Boolean(normalizedDuties.feeReceived);
        return {
          schoolId,
          schoolName,
          ensembleId: ensemble.id,
          ensembleName: ensemble.name || ensemble.id,
          adminDuties: normalizedDuties,
          isAdminDutiesComplete: isComplete,
        };
      })
      .sort((a, b) => {
        if (Boolean(a.isAdminDutiesComplete) !== Boolean(b.isAdminDutiesComplete)) {
          return a.isAdminDutiesComplete ? 1 : -1;
        }
        return (a.ensembleName || "").localeCompare(b.ensembleName || "");
      });
    renderAdminDutiesRows();
  } catch (error) {
    console.error("refreshAdminDutiesPanel failed", error);
    if (state.admin.dutiesLoadVersion !== loadVersion) return;
    state.admin.dutiesRows = [];
    clearAdminDutiesList();
    setAdminDutiesSummary("");
    setAdminDutiesStatus("Unable to load admin checkoffs.");
  }
}

export function renderJudgeOptions(judges) {
  const selects = [
    els.stage1JudgeSelect,
    els.stage2JudgeSelect,
    els.stage3JudgeSelect,
    els.sightJudgeSelect,
  ].filter(Boolean);
  selects.forEach((select) => {
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
  });
}

export function renderAdminSchedule({
  entries = state.event.rosterEntries,
  onWatchEntryStatus,
  onEditTime,
  onDeleteEntry,
  onLoadPacketView,
} = {}) {
  state.subscriptions.entryStatusMap.forEach((unsub) => unsub());
  state.subscriptions.entryStatusMap.clear();
  if (!els.scheduleList) {
    renderAdminReadiness();
    return;
  }
  els.scheduleList.innerHTML = "";
  const sorted = [...entries].sort((a, b) => {
    const aTime = a.performanceAt?.toMillis ? a.performanceAt.toMillis() : 0;
    const bTime = b.performanceAt?.toMillis ? b.performanceAt.toMillis() : 0;
    if (aTime !== bTime) return aTime - bTime;
    const aName = (a.ensembleName || a.ensembleId || "").toLowerCase();
    const bName = (b.ensembleName || b.ensembleId || "").toLowerCase();
    return aName.localeCompare(bName);
  });

  const groups = new Map();
  sorted.forEach((entry) => {
    const label = entry.performanceAt
      ? formatDateHeading(entry.performanceAt)
      : "Legacy (missing datetime)";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry);
  });

  groups.forEach((entries, label) => {
    const heading = document.createElement("div");
    heading.className = "list-heading";
    heading.textContent = label;
    els.scheduleList.appendChild(heading);

    entries.forEach((entry) => {
      const schoolName =
        entry.schoolName || getSchoolNameById(state.admin.schoolsList, entry.schoolId);
      const ensembleName = entry.ensembleName || entry.ensembleId;
      const performanceLabel = formatPerformanceAt(entry.performanceAt);
      const li = document.createElement("li");
      const top = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = performanceLabel || "Missing datetime";
      top.appendChild(strong);
      top.appendChild(document.createTextNode(` - ${ensembleName}`));
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = `School: ${schoolName}`;
      li.appendChild(top);
      li.appendChild(hint);
      const entryStatus = document.createElement("div");
      entryStatus.className = "hint";
      entryStatus.textContent = "Entry: Checking...";
      li.appendChild(entryStatus);
      const unsubscribeEntryStatus = onWatchEntryStatus
        ? onWatchEntryStatus(entry, entryStatus)
        : null;
      if (unsubscribeEntryStatus) {
        state.subscriptions.entryStatusMap.set(entry.id, unsubscribeEntryStatus);
      }

      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.className = "ghost";
      editBtn.textContent = "Edit Time";
      editBtn.addEventListener("click", async () => {
        if (!onEditTime) return;
        await onEditTime(entry);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!onDeleteEntry) return;
        await onDeleteEntry(entry);
      });

      const packetBtn = document.createElement("button");
      packetBtn.textContent = "View Packet";

      const packetPanel = document.createElement("div");
      packetPanel.className = "packet-panel is-hidden";

      packetBtn.addEventListener("click", async () => {
        const isHidden = packetPanel.classList.contains("is-hidden");
        if (isHidden) {
          packetPanel.classList.remove("is-hidden");
          packetBtn.textContent = "Hide Packet";
          if (onLoadPacketView) {
            await onLoadPacketView(entry, packetPanel);
          }
        } else {
          packetPanel.classList.add("is-hidden");
          packetBtn.textContent = "View Packet";
        }
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      actions.appendChild(packetBtn);

      li.appendChild(actions);
      li.appendChild(packetPanel);
      els.scheduleList.appendChild(li);
    });
  });
  renderAdminReadiness();
}

export function renderAdminScheduleList(entries) {
  renderAdminSchedule({
    entries,
    onWatchEntryStatus: (entry, entryStatusEl) =>
      watchEntryStatus(entry, (label) => {
        if (entryStatusEl) entryStatusEl.textContent = label;
      }),
    onEditTime: async (entry) => {
      const current =
        entry.performanceAt?.toDate?.().toISOString().slice(0, 16) ||
        entry.performanceAt?.toDate?.().toLocaleString?.() ||
        "";
      const input = window.prompt("New performance time (YYYY-MM-DDTHH:MM)", current);
      if (!input) return;
      const nextDate = new Date(input);
      if (Number.isNaN(nextDate.getTime())) {
        alertUser("Invalid date/time.");
        return;
      }
      await updateScheduleEntryTime({
        eventId: state.event.active?.id || "",
        entryId: entry.id,
        nextDate,
      });
    },
    onDeleteEntry: async (entry) => {
      if (!confirmUser("Delete this schedule entry?")) return;
      await deleteScheduleEntry({
        eventId: state.event.active?.id || "",
        entryId: entry.id,
      });
    },
    onLoadPacketView: loadAdminPacketView,
  });
}

export function renderSubmissionCard(submission, position, { showTranscript = true } = {}) {
  const card = document.createElement("div");
  card.className = "packet-card";
  const badgeLabel = JUDGE_POSITION_LABELS[position] || position || "Judge";
  if (!submission) {
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = badgeLabel;
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
  badge.textContent = badgeLabel;
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
  audio.className = "audio";
  if (submission.audioUrl) {
    audio.src = submission.audioUrl;
  }

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

export function renderAdminOpenPacketDetail(packet, packetPanel) {
  if (!packetPanel) return;
  packetPanel.innerHTML = "";

  const school = packet.schoolName || packet.schoolId || "Unknown school";
  const ensemble = packet.ensembleName || packet.ensembleId || "Unknown ensemble";
  const slotLabel =
    JUDGE_POSITION_LABELS[packet.judgePosition] || (packet.judgePosition ? packet.judgePosition : "Unassigned");
  const eventLabel = packet.assignmentEventId || "Open (no event)";

  const header = document.createElement("div");
  header.className = "packet-header";
  header.textContent = `${school} • ${ensemble} • Slot: ${slotLabel} • Event: ${eventLabel}`;
  packetPanel.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "packet-grid";

  const syntheticSubmission = {
    id: packet.id,
    status: packet.status || "draft",
    locked: Boolean(packet.locked),
    judgePosition: packet.judgePosition || "",
    judgeName: packet.createdByJudgeName || "",
    judgeEmail: packet.createdByJudgeEmail || "",
    judgeTitle: packet.createdByJudgeTitle || "",
    judgeAffiliation: packet.createdByJudgeAffiliation || "",
    formType: packet.formType || FORM_TYPES.stage,
    captions: packet.captions || {},
    captionScoreTotal: packet.captionScoreTotal ?? null,
    computedFinalRatingLabel: packet.computedFinalRatingLabel || "N/A",
    audioUrl: packet.latestAudioUrl || "",
    transcript: "",
    transcriptFull: "",
  };
  grid.appendChild(
    renderSubmissionCard(syntheticSubmission, packet.judgePosition || "Judge", {
      showTranscript: false,
    })
  );

  packetPanel.appendChild(grid);
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
    header.textContent = `Director: ${directorName || "Unknown"} â€¢ Grade: ${
      grade || "Unknown"
    } â€¢ Overall: ${summary?.overall?.label || "N/A"}`;
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

export function renderDirectorPackets(groups) {
  els.directorPackets.innerHTML = "";
  if (els.directorEmpty) {
    els.directorEmpty.style.display = groups.length ? "none" : "block";
  }
  if (!groups.length) {
    return;
  }

  for (const group of groups) {
    const wrapper = document.createElement("div");
    wrapper.className = "packet";

    if (group.type === "open-assembled") {
      const header = document.createElement("div");
      header.className = "packet-header";
      const ensembleRow = document.createElement("div");
      const ensembleLabel = document.createElement("strong");
      ensembleLabel.textContent = "Open Judge Packet Set:";
      ensembleRow.appendChild(ensembleLabel);
      ensembleRow.appendChild(
        document.createTextNode(` ${group.ensembleName || group.ensembleId || "Unknown ensemble"}`)
      );
      const schoolRow = document.createElement("div");
      schoolRow.className = "note";
      schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
      const eventRow = document.createElement("div");
      eventRow.className = "note";
      eventRow.textContent = `Event: ${group.eventId || "Unassigned"}`;
      const directorRow = document.createElement("div");
      directorRow.className = "note";
      directorRow.textContent = `Director: ${group.directorName || "Unknown"}`;
      const gradeRow = document.createElement("div");
      gradeRow.className = "note";
      gradeRow.textContent = `Grade: ${group.grade || "Unknown"}`;
      const overallRow = document.createElement("div");
      overallRow.className = "note";
      overallRow.textContent = `Overall: ${group.overall?.label || "N/A"}`;
      header.appendChild(ensembleRow);
      header.appendChild(schoolRow);
      header.appendChild(eventRow);
      header.appendChild(directorRow);
      header.appendChild(gradeRow);
      header.appendChild(overallRow);
      if (group.hasConflicts) {
        const conflictRow = document.createElement("div");
        conflictRow.className = "note";
        conflictRow.textContent = `Conflict: duplicate packet(s) for ${group.conflicts.join(", ")}`;
        header.appendChild(conflictRow);
      }

      const grid = document.createElement("div");
      grid.className = "packet-grid";
      Object.values(JUDGE_POSITIONS).forEach((position) => {
        const submission = group.submissions[position];
        if (submission && submission.status === STATUSES.released) {
          grid.appendChild(renderSubmissionCard(submission, position, { showTranscript: false }));
        }
      });

      wrapper.appendChild(header);
      wrapper.appendChild(grid);
      els.directorPackets.appendChild(wrapper);
      continue;
    }

    if (group.type === "open") {
      const header = document.createElement("div");
      header.className = "packet-header";
      const ensembleRow = document.createElement("div");
      const ensembleLabel = document.createElement("strong");
      ensembleLabel.textContent = "Open Packet";
      ensembleRow.appendChild(ensembleLabel);
      const schoolRow = document.createElement("div");
      schoolRow.className = "note";
      schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
      const ensembleNameRow = document.createElement("div");
      ensembleNameRow.className = "note";
      ensembleNameRow.textContent = `Ensemble: ${group.ensembleName || group.ensembleId || "Unknown"}`;
      const ratingRow = document.createElement("div");
      ratingRow.className = "note";
      ratingRow.textContent = `Final Rating: ${group.computedFinalRatingLabel || "N/A"}`;
      const slotRow = document.createElement("div");
      slotRow.className = "note";
      slotRow.textContent = `Slot: ${
        JUDGE_POSITION_LABELS[group.judgePosition] ||
        (group.judgePosition ? group.judgePosition : "Unassigned")
      }`;
      header.appendChild(ensembleRow);
      header.appendChild(schoolRow);
      header.appendChild(ensembleNameRow);
      header.appendChild(slotRow);
      header.appendChild(ratingRow);

      const grid = document.createElement("div");
      grid.className = "packet-grid";
      const scoringCard = document.createElement("div");
      scoringCard.className = "packet-card";
      const scoringHeader = document.createElement("div");
      scoringHeader.className = "row";
      const scoringBadge = document.createElement("span");
      scoringBadge.className = "badge";
      scoringBadge.textContent = "Judge";
      const scoringStatus = document.createElement("span");
      scoringStatus.className = "note";
      scoringStatus.textContent = `Status: ${group.status || "released"}`;
      const scoringLocked = document.createElement("span");
      scoringLocked.className = "note";
      scoringLocked.textContent = `Locked: ${group.locked ? "yes" : "no"}`;
      scoringHeader.appendChild(scoringBadge);
      scoringHeader.appendChild(scoringStatus);
      scoringHeader.appendChild(scoringLocked);

      const judgeInfo = document.createElement("div");
      judgeInfo.className = "note";
      judgeInfo.textContent =
        group.judgeName && group.judgeEmail
          ? `${group.judgeName} - ${group.judgeEmail}`
          : group.judgeName || group.judgeEmail || "Unknown judge";

      const captionSummary = renderPacketCaptionSummary(
        group.captions || {},
        group.formType || FORM_TYPES.stage
      );
      if (!Object.keys(group.captions || {}).length) {
        const empty = document.createElement("div");
        empty.className = "note";
        empty.textContent = "No captions available.";
        captionSummary.appendChild(empty);
      }

      const scoringFooter = document.createElement("div");
      scoringFooter.className = "note";
      scoringFooter.textContent =
        `Caption Total: ${group.captionScoreTotal || 0} - Final Rating: ${group.computedFinalRatingLabel || "N/A"}`;

      scoringCard.appendChild(scoringHeader);
      scoringCard.appendChild(judgeInfo);
      scoringCard.appendChild(captionSummary);
      scoringCard.appendChild(scoringFooter);
      grid.appendChild(scoringCard);

      if (group.latestAudioUrl) {
        const audioCard = document.createElement("div");
        audioCard.className = "packet-card";
        const audioBadge = document.createElement("div");
        audioBadge.className = "badge";
        audioBadge.textContent = "Audio";
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = group.latestAudioUrl;
        audio.className = "audio";
        audioCard.appendChild(audioBadge);
        audioCard.appendChild(audio);
        grid.appendChild(audioCard);
      }

      wrapper.appendChild(header);
      wrapper.appendChild(grid);
      els.directorPackets.appendChild(wrapper);
      continue;
    }

    const header = document.createElement("div");
    header.className = "packet-header";
    const directorName = group.directorName || "Unknown";
    const ensembleRow = document.createElement("div");
    const ensembleLabel = document.createElement("strong");
    ensembleLabel.textContent = "Ensemble:";
    ensembleRow.appendChild(ensembleLabel);
    ensembleRow.appendChild(document.createTextNode(` ${group.ensembleId}`));
    const schoolRow = document.createElement("div");
    schoolRow.className = "note";
    schoolRow.textContent = `School: ${group.schoolId}`;
    const directorRow = document.createElement("div");
    directorRow.className = "note";
    directorRow.textContent = `Director: ${directorName}`;
    const eventRow = document.createElement("div");
    eventRow.className = "note";
    eventRow.textContent = `Event: ${group.eventId}`;
    const gradeRow = document.createElement("div");
    gradeRow.className = "note";
    gradeRow.textContent = `Grade: ${group.grade || "Unknown"}`;
    const overallRow = document.createElement("div");
    overallRow.className = "note";
    overallRow.textContent = `Overall: ${group.overall.label}`;
    header.appendChild(ensembleRow);
    header.appendChild(schoolRow);
    header.appendChild(directorRow);
    header.appendChild(eventRow);
    header.appendChild(gradeRow);
    header.appendChild(overallRow);

    const grid = document.createElement("div");
    grid.className = "packet-grid";
    Object.values(JUDGE_POSITIONS).forEach((position) => {
      const submission = group.submissions[position];
      if (submission && submission.status === STATUSES.released) {
        grid.appendChild(renderSubmissionCard(submission, position, { showTranscript: false }));
      }
    });

    const siteRatingCard = document.createElement("div");
    siteRatingCard.className = "packet-card";
    const siteBadge = document.createElement("div");
    siteBadge.className = "badge";
    siteBadge.textContent = "Site Rating";
    const siteNote = document.createElement("div");
    siteNote.className = "note";
    siteNote.textContent = "Site rating details coming soon.";
    siteRatingCard.appendChild(siteBadge);
    siteRatingCard.appendChild(siteNote);
    grid.appendChild(siteRatingCard);

    wrapper.appendChild(header);
    wrapper.appendChild(grid);
    els.directorPackets.appendChild(wrapper);
  }
}

export function renderDirectorEnsembles(ensembles) {
  if (!els.directorEnsembleList) return;
  els.directorEnsembleList.innerHTML = "";
  ensembles.forEach((ensemble) => {
    const li = document.createElement("li");
    li.className = "ensemble-row";
    const isActive = ensemble.id === state.director.selectedEnsembleId;
    if (isActive) {
      return;
    }
    const name = document.createElement("div");
    name.className = isActive ? "ensemble-name is-active" : "ensemble-name";
    name.textContent = ensemble.name || "Untitled";
    li.appendChild(name);
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
      deleteBtn.dataset.loadingLabel = "Deleting...";
      deleteBtn.dataset.spinner = "true";
      await withLoading(deleteBtn, async () => {
        await handleDirectorEnsembleDelete(ensemble.id, ensemble.name);
      });
    });
      const actions = document.createElement("div");
      actions.className = "ensemble-actions";
      if (!isActive) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "ghost";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
          setDirectorEnsembleFormMode({ mode: "edit", ensemble });
          els.directorEnsembleNameInput?.focus();
        });
        actions.appendChild(editBtn);

        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.textContent = "Set Active";
        selectBtn.addEventListener("click", () => handleDirectorEnsembleSelection(ensemble.id));
        actions.appendChild(selectBtn);
      }
      actions.appendChild(deleteBtn);
      li.appendChild(actions);
      els.directorEnsembleList.appendChild(li);
    });
}

let adminHandlersBound = false;
let judgeOpenHandlersBound = false;
let tapePlaybackBound = false;
let directorHandlersBound = false;
let appHandlersBound = false;

function updateScheduleSubmitState() {
  if (!els.scheduleSubmitBtn) return;
  const ready =
    Boolean(state.event.active) &&
    Boolean(els.performanceAtInput?.value) &&
    Boolean(els.scheduleSchoolSelect?.value) &&
    Boolean(els.scheduleEnsembleSelect?.value);
  els.scheduleSubmitBtn.disabled = !ready;
}

export function bindAdminHandlers() {
  if (adminHandlersBound) return;
  adminHandlersBound = true;

  renderAdminLogisticsEnsembleOptions(els.adminLogisticsCurrentEnsembleSelect, []);
  renderAdminLogisticsEnsembleOptions(els.adminLogisticsNextEnsembleSelect, []);
  refreshAdminLogisticsEntry();

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
      await createEvent({ name, startAtDate, endAtDate });
      if (els.eventNameInput) els.eventNameInput.value = "";
    });
  }

  if (els.assignmentsForm) {
    els.assignmentsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.event.active) {
        if (els.assignmentsError) {
          els.assignmentsError.textContent = "Create and activate an event first.";
        }
        return;
      }
      const stage1Uid = els.stage1JudgeSelect?.value || "";
      const stage2Uid = els.stage2JudgeSelect?.value || "";
      const stage3Uid = els.stage3JudgeSelect?.value || "";
      const sightUid = els.sightJudgeSelect?.value || "";
      if (!stage1Uid || !stage2Uid || !stage3Uid || !sightUid) {
        if (els.assignmentsError) {
          els.assignmentsError.textContent = "Select all judge assignments.";
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

  if (els.scheduleSchoolSelect) {
    els.scheduleSchoolSelect.addEventListener("change", () => {
      const schoolId = els.scheduleSchoolSelect.value;
      watchScheduleEnsembles(schoolId, renderScheduleEnsembles);
      updateScheduleSubmitState();
    });
  }

  if (els.scheduleEnsembleSelect) {
    els.scheduleEnsembleSelect.addEventListener("change", () => {
      updateScheduleSubmitState();
    });
  }

  if (els.performanceAtInput) {
    els.performanceAtInput.addEventListener("change", updateScheduleSubmitState);
  }

  if (els.adminLogisticsCurrentSchoolSelect) {
    els.adminLogisticsCurrentSchoolSelect.addEventListener("change", async () => {
      const schoolId = els.adminLogisticsCurrentSchoolSelect?.value || "";
      if (!schoolId) {
        state.admin.logisticsCurrentEnsembles = [];
        renderAdminLogisticsEnsembleOptions(els.adminLogisticsCurrentEnsembleSelect, []);
        refreshAdminLogisticsEntry();
        return;
      }
      try {
        state.admin.logisticsCurrentEnsembles = await fetchAdminLogisticsEnsembles(schoolId);
        renderAdminLogisticsEnsembleOptions(
          els.adminLogisticsCurrentEnsembleSelect,
          state.admin.logisticsCurrentEnsembles
        );
      } catch (error) {
        console.error("Load current logistics ensembles failed", error);
        state.admin.logisticsCurrentEnsembles = [];
        renderAdminLogisticsEnsembleOptions(els.adminLogisticsCurrentEnsembleSelect, []);
      }
      refreshAdminLogisticsEntry();
    });
  }

  if (els.adminLogisticsNextSchoolSelect) {
    els.adminLogisticsNextSchoolSelect.addEventListener("change", async () => {
      const schoolId = els.adminLogisticsNextSchoolSelect?.value || "";
      if (!schoolId) {
        state.admin.logisticsNextEnsembles = [];
        renderAdminLogisticsEnsembleOptions(els.adminLogisticsNextEnsembleSelect, []);
        refreshAdminLogisticsEntry();
        return;
      }
      try {
        state.admin.logisticsNextEnsembles = await fetchAdminLogisticsEnsembles(schoolId);
        renderAdminLogisticsEnsembleOptions(
          els.adminLogisticsNextEnsembleSelect,
          state.admin.logisticsNextEnsembles
        );
      } catch (error) {
        console.error("Load next logistics ensembles failed", error);
        state.admin.logisticsNextEnsembles = [];
        renderAdminLogisticsEnsembleOptions(els.adminLogisticsNextEnsembleSelect, []);
      }
      refreshAdminLogisticsEntry();
    });
  }

  if (els.adminLogisticsCurrentEnsembleSelect) {
    els.adminLogisticsCurrentEnsembleSelect.addEventListener("change", () => {
      refreshAdminLogisticsEntry();
    });
  }

  if (els.adminLogisticsNextEnsembleSelect) {
    els.adminLogisticsNextEnsembleSelect.addEventListener("change", () => {
      refreshAdminLogisticsEntry();
    });
  }

  if (els.adminDutiesSchoolSelect) {
    els.adminDutiesSchoolSelect.addEventListener("change", () => {
      refreshAdminDutiesPanel();
    });
  }

  if (els.adminDutiesSearchInput) {
    els.adminDutiesSearchInput.addEventListener("input", () => {
      state.admin.dutiesSearchQuery = els.adminDutiesSearchInput.value || "";
      renderAdminDutiesRows();
    });
  }

  if (els.scheduleForm) {
    els.scheduleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.event.active) {
        alertUser("Create and activate an event first.");
        return;
      }
      const performanceAtValue = els.performanceAtInput?.value || "";
      const schoolId = els.scheduleSchoolSelect?.value || "";
      const ensembleId = els.scheduleEnsembleSelect?.value || "";
      if (!performanceAtValue || !schoolId || !ensembleId) return;
      const ensembleName =
        els.scheduleEnsembleSelect?.selectedOptions?.[0]?.textContent || ensembleId;
      await createScheduleEntry({
        eventId: state.event.active.id,
        performanceAtDate: new Date(performanceAtValue),
        schoolId,
        ensembleId,
        ensembleName,
      });
      els.scheduleForm.reset?.();
      updateScheduleSubmitState();
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
      if (els.adminSchoolManageEditBtn) {
        els.adminSchoolManageEditBtn.disabled = !hasSelection;
      }
      if (els.adminSchoolManageDeleteBtn) {
        els.adminSchoolManageDeleteBtn.disabled = !hasSelection;
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
      if (els.schoolResult) {
        els.schoolResult.textContent = `Imported ${result.count} schools.`;
      }
    });
  }

  if (els.provisionForm) {
    els.provisionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = els.provisionEmailInput?.value.trim() || "";
      const name = els.provisionNameInput?.value.trim() || "";
      const role = els.provisionRoleSelect?.value || "judge";
      const schoolId = els.provisionSchoolSelect?.value || null;
      const tempPassword = els.provisionTempPasswordInput?.value.trim() || "";
      if (!email || !name) {
        alertUser("Email and name are required.");
        return;
      }
      const result = await provisionUser({
        email,
        name,
        role,
        schoolId,
        tempPassword: tempPassword || null,
      });
      if (els.provisionResult) {
        const password = result?.tempPassword || tempPassword || "";
        els.provisionResult.textContent = password
          ? `Provisioned. Temp password: ${password}`
          : "Provisioned.";
      }
    });
  }
}

export function bindJudgeOpenHandlers() {
  if (judgeOpenHandlersBound) return;
  judgeOpenHandlersBound = true;

  if (els.judgeOpenPacketSelect) {
    els.judgeOpenPacketSelect.addEventListener("change", async () => {
      const packetId = els.judgeOpenPacketSelect.value || "";
      await openJudgeOpenPacket(packetId);
    });
  }

  if (els.judgeOpenBackBtn) {
    els.judgeOpenBackBtn.addEventListener("click", () => {
      hideOpenDetailView();
    });
  }

  if (els.judgeOpenTapePlayback && !tapePlaybackBound) {
    tapePlaybackBound = true;
    els.judgeOpenTapePlayback.addEventListener("ended", () => {
      const playlist = state.judgeOpen.tapePlaylist || [];
      if (!playlist.length) return;
      const nextIndex = (state.judgeOpen.tapePlaylistIndex || 0) + 1;
      if (nextIndex >= playlist.length) {
        state.judgeOpen.tapePlaylistIndex = 0;
        return;
      }
      state.judgeOpen.tapePlaylistIndex = nextIndex;
      els.judgeOpenTapePlayback.src = playlist[nextIndex].url;
      els.judgeOpenTapePlayback.play();
    });
  }

  if (els.judgeOpenNewPacketBtn) {
    els.judgeOpenNewPacketBtn.addEventListener("click", async () => {
      els.judgeOpenNewPacketBtn.dataset.loadingLabel = "Creating...";
      els.judgeOpenNewPacketBtn.dataset.spinner = "true";
      await withLoading(els.judgeOpenNewPacketBtn, async () => {
        setOpenPacketHint("Creating draft tape...");
        const payload = gatherOpenPacketMeta();
        const result = await createOpenPacket({ ...payload, onSessions: renderOpenSegments });
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Unable to create packet.");
          return;
        }
        state.judgeOpen.tapePlaylistIndex = 0;
        if (els.judgeOpenPacketSelect && result.packetId) {
          els.judgeOpenPacketSelect.value = result.packetId;
        }
        await saveOpenPrefsToServer({
          lastJudgeOpenPacketId: result.packetId,
          lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
        });
        if (state.auth.userProfile) {
          state.auth.userProfile.preferences = {
            ...(state.auth.userProfile.preferences || {}),
            lastJudgeOpenPacketId: result.packetId,
            lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
          };
        }
        setOpenPacketHint("Draft packet created.");
        renderOpenCaptionForm();
        updateOpenHeader();
        showOpenDetailView();
        updateOpenEmptyState();
        updateOpenSubmitState();
      });
    });
  }

  if (els.judgeOpenClearRecentBtn) {
    els.judgeOpenClearRecentBtn.addEventListener("click", async () => {
      saveOpenPrefs({ lastPacketId: "", lastFormType: "" });
      await saveOpenPrefsToServer({
        lastJudgeOpenPacketId: "",
        lastJudgeOpenFormType: "",
      });
      if (state.auth.userProfile) {
        state.auth.userProfile.preferences = {
          ...(state.auth.userProfile.preferences || {}),
          lastJudgeOpenPacketId: "",
          lastJudgeOpenFormType: "",
        };
      }
      state.judgeOpen.currentPacketId = null;
      state.judgeOpen.currentPacket = null;
      state.judgeOpen.selectedExisting = null;
      setJudgeOpenDirectorReferenceState(
        "not-linked",
        "Link an existing ensemble to load Director repertoire/instrumentation.",
        null
      );
      renderJudgeOpenDirectorReference();
      if (els.judgeOpenPacketSelect) {
        els.judgeOpenPacketSelect.value = "";
      }
      if (els.judgeOpenTranscriptInput) {
        els.judgeOpenTranscriptInput.value = "";
      }
      state.judgeOpen.transcriptText = "";
      if (els.judgeOpenSchoolNameInput) {
        els.judgeOpenSchoolNameInput.value = "";
      }
      if (els.judgeOpenEnsembleNameInput) {
        els.judgeOpenEnsembleNameInput.value = "";
      }
      state.judgeOpen.captions = {};
      if (els.judgeOpenDraftStatus) {
        els.judgeOpenDraftStatus.textContent = "";
      }
      updateOpenHeader();
      hideOpenDetailView();
      setOpenPacketHint("Recent packet cleared.");
      renderOpenCaptionForm();
      updateOpenEmptyState();
      updateOpenSubmitState();
    });
  }

  if (els.judgeOpenDefaultFormBtn) {
    els.judgeOpenDefaultFormBtn.addEventListener("click", async () => {
      const formType = els.judgeOpenFormTypeSelect?.value || "stage";
      saveOpenPrefs({ defaultFormType: formType });
      await saveOpenPrefsToServer({ judgeOpenDefaultFormType: formType });
      if (state.auth.userProfile) {
        state.auth.userProfile.preferences = {
          ...(state.auth.userProfile.preferences || {}),
          judgeOpenDefaultFormType: formType,
        };
      }
      setOpenPacketHint("Default form saved.");
    });
  }

  if (els.judgeOpenUseEventDefaultsToggle) {
    els.judgeOpenUseEventDefaultsToggle.addEventListener("change", () => {
      state.judgeOpen.useActiveEventDefaults = Boolean(els.judgeOpenUseEventDefaultsToggle.checked);
      syncOpenEventDefaultsUI();
      refreshOpenEventDefaultsState();
      if (state.judgeOpen.useActiveEventDefaults) {
        setOpenPacketHint("Active event defaults enabled.");
      } else {
        setOpenPacketHint("Open mode enabled.");
      }
    });
  }

  if (els.judgeOpenSaveEventDefaultsBtn) {
    els.judgeOpenSaveEventDefaultsBtn.addEventListener("click", async () => {
      const enabled = getOpenEventDefaultsPreference();
      saveOpenPrefs({ useActiveEventDefaults: enabled });
      await saveOpenPrefsToServer({ judgeOpenUseActiveEventDefaults: enabled });
      if (state.auth.userProfile) {
        state.auth.userProfile.preferences = {
          ...(state.auth.userProfile.preferences || {}),
          judgeOpenUseActiveEventDefaults: enabled,
        };
      }
      setOpenPacketHint("Judge mode default saved.");
    });
  }

  if (els.judgeOpenExistingSelect) {
    els.judgeOpenExistingSelect.addEventListener("change", () => {
      const option = els.judgeOpenExistingSelect.selectedOptions?.[0];
      if (!option) return;
      const schoolId = option.dataset.schoolId || "";
      const ensembleId = option.dataset.ensembleId || "";
      const schoolName = option.dataset.schoolName || "";
      const ensembleName = option.dataset.ensembleName || "";
      if (els.judgeOpenSchoolNameInput) {
        els.judgeOpenSchoolNameInput.value = schoolName;
      }
      if (els.judgeOpenEnsembleNameInput) {
        els.judgeOpenEnsembleNameInput.value = ensembleName;
      }
      state.judgeOpen.selectedExisting = {
        schoolId,
        schoolName,
        ensembleId,
        ensembleName,
      };
      markJudgeOpenDirty();
      updateOpenHeader();
      if (state.judgeOpen.currentPacketId) {
        updateOpenPacketDraft({
          schoolId,
          ensembleId,
          schoolName,
          ensembleName,
          ensembleSnapshot: buildOpenEnsembleSnapshot(),
        });
      }
      refreshJudgeOpenDirectorReference({ persistToPacket: true });
    });
  }

  if (els.judgeOpenFormTypeSelect) {
    els.judgeOpenFormTypeSelect.addEventListener("change", () => {
      state.judgeOpen.formType = els.judgeOpenFormTypeSelect.value || "stage";
      saveOpenPrefs({ lastFormType: state.judgeOpen.formType });
      renderOpenCaptionForm();
      syncOpenFormTypeSegmented();
      markJudgeOpenDirty();
      if (state.judgeOpen.currentPacketId) {
        updateOpenPacketDraft({ formType: state.judgeOpen.formType });
      }
    });
  }

  if (els.judgeOpenFormTypeSegmented) {
    els.judgeOpenFormTypeSegmented.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-form]");
      if (!button) return;
      const formType = button.dataset.form || "stage";
      state.judgeOpen.formType = formType;
      if (els.judgeOpenFormTypeSelect) {
        els.judgeOpenFormTypeSelect.value = formType;
      }
      saveOpenPrefs({ lastFormType: state.judgeOpen.formType });
      renderOpenCaptionForm();
      syncOpenFormTypeSegmented();
      markJudgeOpenDirty();
      if (state.judgeOpen.currentPacketId) {
        updateOpenPacketDraft({ formType: state.judgeOpen.formType });
      }
    });
  }

  if (els.judgeOpenSchoolNameInput) {
    els.judgeOpenSchoolNameInput.addEventListener("input", () => {
      markJudgeOpenDirty();
      state.judgeOpen.selectedExisting = null;
      if (els.judgeOpenExistingSelect) {
        els.judgeOpenExistingSelect.value = "";
      }
      if (state.judgeOpen.currentPacketId) {
        updateOpenPacketDraft({
          schoolName: els.judgeOpenSchoolNameInput.value || "",
          schoolId: "",
          ensembleId: "",
          ensembleSnapshot: null,
        });
      }
      setJudgeOpenDirectorReferenceState(
        "not-linked",
        "Link an existing ensemble to load Director repertoire/instrumentation.",
        null
      );
      renderJudgeOpenDirectorReference();
      syncOpenDirectorEntrySnapshotDraft(null);
      updateOpenHeader();
    });
  }

  if (els.judgeOpenEnsembleNameInput) {
    els.judgeOpenEnsembleNameInput.addEventListener("input", () => {
      markJudgeOpenDirty();
      state.judgeOpen.selectedExisting = null;
      if (els.judgeOpenExistingSelect) {
        els.judgeOpenExistingSelect.value = "";
      }
      if (state.judgeOpen.currentPacketId) {
        updateOpenPacketDraft({
          ensembleName: els.judgeOpenEnsembleNameInput.value || "",
          schoolId: "",
          ensembleId: "",
          ensembleSnapshot: null,
        });
      }
      setJudgeOpenDirectorReferenceState(
        "not-linked",
        "Link an existing ensemble to load Director repertoire/instrumentation.",
        null
      );
      renderJudgeOpenDirectorReference();
      syncOpenDirectorEntrySnapshotDraft(null);
      updateOpenHeader();
    });
  }

  if (els.judgeOpenTranscriptInput) {
    els.judgeOpenTranscriptInput.addEventListener("input", () => {
      state.judgeOpen.transcriptText = els.judgeOpenTranscriptInput.value || "";
      markJudgeOpenDirty();
      updateOpenSubmitState();
    });
  }

  if (els.judgeOpenDraftBtn) {
    els.judgeOpenDraftBtn.addEventListener("click", async () => {
      const transcript = state.judgeOpen.transcriptText || "";
      if (!transcript.trim()) {
        if (els.judgeOpenDraftStatus) {
          els.judgeOpenDraftStatus.textContent = "Add a transcript before drafting captions.";
        }
        return;
      }
      if (!els.judgeOpenCaptionForm?.children?.length) {
        renderOpenCaptionForm();
      }
      const overwrite = Boolean(els.judgeOpenOverwriteCaptionsToggle?.checked);
      els.judgeOpenDraftBtn.dataset.loadingLabel = "Drafting...";
      els.judgeOpenDraftBtn.dataset.spinner = "true";
      await withLoading(els.judgeOpenDraftBtn, async () => {
        if (els.judgeOpenDraftStatus) {
          els.judgeOpenDraftStatus.textContent = "Drafting captions. Please wait...";
        }
        const result = await draftCaptionsFromTranscript({
          transcript,
          formType: state.judgeOpen.formType || "stage",
        });
        if (!result?.ok) {
          if (els.judgeOpenDraftStatus) {
            els.judgeOpenDraftStatus.textContent =
              result?.message || "Unable to draft captions.";
          }
          return;
        }
        applyOpenCaptionDraft({ captions: result.captions, overwrite });
        if (els.judgeOpenDraftStatus) {
          els.judgeOpenDraftStatus.textContent = "Drafted captions.";
        }
      });
    });
  }

  if (els.judgeOpenTranscribeBtn) {
    els.judgeOpenTranscribeBtn.addEventListener("click", async () => {
      if (els.judgeOpenTranscribeBtn.disabled) return;
      els.judgeOpenTranscribeBtn.dataset.loadingLabel = "Transcribing...";
      els.judgeOpenTranscribeBtn.dataset.spinner = "true";
      await withLoading(els.judgeOpenTranscribeBtn, async () => {
        const result = await transcribeOpenTape();
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Transcription failed.");
          return;
        }
        if (els.judgeOpenTranscriptInput) {
          els.judgeOpenTranscriptInput.value = result.transcript || "";
        }
        state.judgeOpen.transcriptText = result.transcript || "";
        updateOpenSubmitState();
        setOpenPacketHint("Transcription complete.");
      });
    });
  }

  if (els.judgeOpenRecordBtn) {
    els.judgeOpenRecordBtn.addEventListener("click", async () => {
      els.judgeOpenRecordBtn.dataset.loadingLabel = "Starting...";
      els.judgeOpenRecordBtn.dataset.spinner = "true";
      await withLoading(els.judgeOpenRecordBtn, async () => {
        const result = await startOpenRecording({
          getPacketMeta: gatherOpenPacketMeta,
          onSessions: renderOpenSegments,
          onStatus: updateOpenRecordingStatus,
        });
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Unable to start recording.");
          return;
        }
      });
      updateOpenRecordingStatus();
    });
  }

  if (els.judgeOpenStopBtn) {
    els.judgeOpenStopBtn.addEventListener("click", () => {
      els.judgeOpenStopBtn.dataset.loadingLabel = "Stopping...";
      els.judgeOpenStopBtn.dataset.spinner = "true";
      withLoading(els.judgeOpenStopBtn, async () => {
        stopOpenRecording();
      }).finally(() => {
        updateOpenRecordingStatus();
      });
    });
  }

  if (els.judgeOpenCaptionForm) {
    els.judgeOpenCaptionForm.addEventListener("click", (event) => {
      const gradeBtn = event.target?.closest?.("[data-grade]");
      const modifierBtn = event.target?.closest?.("[data-modifier]");
      const wrapper = event.target?.closest?.("[data-key]");
      if (!wrapper) return;
      const key = wrapper.dataset.key;
      const current = state.judgeOpen.captions[key] || {};
      if (gradeBtn) {
        const nextGrade = gradeBtn.dataset.grade || "";
        state.judgeOpen.captions[key] = {
          ...current,
          gradeLetter: nextGrade,
        };
        markJudgeOpenDirty();
        applyOpenCaptionState();
        updateOpenSubmitState();
      }
      if (modifierBtn) {
        const nextModifier = modifierBtn.dataset.modifier || "";
        state.judgeOpen.captions[key] = {
          ...current,
          gradeModifier: current.gradeModifier === nextModifier ? "" : nextModifier,
        };
        markJudgeOpenDirty();
        applyOpenCaptionState();
        updateOpenSubmitState();
      }
    });
    els.judgeOpenCaptionForm.addEventListener("input", (event) => {
      const wrapper = event.target?.closest?.("[data-key]");
      if (!wrapper) return;
      if (!event.target?.matches("[data-comment]")) return;
      const key = wrapper.dataset.key;
      const current = state.judgeOpen.captions[key] || {};
      state.judgeOpen.captions[key] = {
        ...current,
        comment: event.target.value || "",
      };
      markJudgeOpenDirty();
      applyOpenCaptionState();
      updateOpenSubmitState();
    });
  }

  if (els.judgeOpenSubmitBtn) {
    els.judgeOpenSubmitBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      const result = await submitOpenPacket();
      if (!result?.ok) {
        setOpenPacketHint(result?.message || "Unable to submit packet.");
        return;
      }
      setOpenPacketHint("Submitted and locked. Admin must release to Director.");
      const refreshed = await selectOpenPacket(state.judgeOpen.currentPacketId, {
        onSessions: renderOpenSegments,
      });
      if (refreshed?.ok) {
        renderOpenCaptionForm();
        updateOpenHeader();
        showOpenDetailView();
        updateOpenSubmitState();
      }
    });
  }
}

function gatherOpenPacketMeta() {
  const existing = state.judgeOpen.selectedExisting || {};
  return {
    schoolName: els.judgeOpenSchoolNameInput?.value?.trim() || "",
    ensembleName: els.judgeOpenEnsembleNameInput?.value?.trim() || "",
    schoolId: existing.schoolId || "",
    ensembleId: existing.ensembleId || "",
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
  template.forEach(({ key }) => {
    const text = String(captions[key] || "").trim();
    if (!text) return;
    const existing = state.judgeOpen.captions[key]?.comment || "";
    if (!overwrite && existing) return;
    if (!state.judgeOpen.captions[key]) {
      state.judgeOpen.captions[key] = {
        gradeLetter: "",
        gradeModifier: "",
        comment: "",
      };
    }
    state.judgeOpen.captions[key].comment = text;
  });
  applyOpenCaptionState();
  markJudgeOpenDirty();
}

function updateOpenRecordingStatus() {
  if (!els.judgeOpenRecordingStatus) return;
  const setMicDebug = () => {
    if (!els.judgeOpenMicSettingsDebug) return;
    const s = state.judgeOpen.micTrackSettings;
    if (!s) {
      els.judgeOpenMicSettingsDebug.textContent = "";
      return;
    }
    const ec = s.echoCancellation;
    const ns = s.noiseSuppression;
    const agc = s.autoGainControl;
    els.judgeOpenMicSettingsDebug.textContent =
      `Mic settings: EC=${String(ec)} - NS=${String(ns)} - AGC=${String(agc)}`;
  };
  const recorder = state.judgeOpen.mediaRecorder;
  if (recorder && recorder.state === "recording") {
    els.judgeOpenRecordingStatus.textContent = "Recording...";
    els.judgeOpenRecordingStatus.classList.add("recording-active");
    if (els.judgeOpenRecordDot) {
      els.judgeOpenRecordDot.classList.add("is-active");
    }
    if (els.judgeOpenRecordLabel) {
      els.judgeOpenRecordLabel.textContent = "Recording...";
    }
    if (els.judgeOpenRecordBtn) {
      els.judgeOpenRecordBtn.classList.add("is-recording");
    }
    if (els.judgeOpenRecordBtn) els.judgeOpenRecordBtn.disabled = true;
    if (els.judgeOpenStopBtn) els.judgeOpenStopBtn.disabled = false;
    startOpenLevelMeter(recorder.stream);
    setMicDebug();
    updateOpenSubmitState();
    return;
  }
  els.judgeOpenRecordingStatus.classList.remove("recording-active");
  if (els.judgeOpenRecordDot) {
    els.judgeOpenRecordDot.classList.remove("is-active");
  }
  if (els.judgeOpenRecordLabel) {
    els.judgeOpenRecordLabel.textContent = "Start Recording";
  }
  if (els.judgeOpenRecordBtn) {
    els.judgeOpenRecordBtn.classList.remove("is-recording");
  }
  stopOpenLevelMeter();
  if (state.judgeOpen.pendingUploads > 0) {
    els.judgeOpenRecordingStatus.textContent = "Saving chunks...";
  } else {
    els.judgeOpenRecordingStatus.textContent = "Recording saved.";
  }
  setMicDebug();
  if (els.judgeOpenRecordBtn) els.judgeOpenRecordBtn.disabled = false;
  if (els.judgeOpenStopBtn) els.judgeOpenStopBtn.disabled = true;
  updateOpenSubmitState();
}

export function bindDirectorHandlers() {
  if (directorHandlersBound) return;
  directorHandlersBound = true;

  if (els.directorProfileToggleBtn) {
    els.directorProfileToggleBtn.addEventListener("click", () => {
      openDirectorProfileModal();
    });
  }

  if (els.directorShowEnsembleFormBtn) {
    els.directorShowEnsembleFormBtn.addEventListener("click", () => {
      setDirectorEnsembleFormMode({ mode: "create" });
      if (els.directorEnsembleNameInput) {
        els.directorEnsembleNameInput.focus();
      }
    });
  }

  if (els.directorEnsembleCancelBtn) {
    els.directorEnsembleCancelBtn.addEventListener("click", () => {
      closeDirectorEnsembleForm();
    });
  }

  if (els.directorEditActiveEnsembleBtn) {
    els.directorEditActiveEnsembleBtn.addEventListener("click", () => {
      const active = state.director.ensemblesCache.find(
        (ensemble) => ensemble.id === state.director.selectedEnsembleId
      );
      if (!active) return;
      setDirectorEnsembleFormMode({ mode: "edit", ensemble: active });
      els.directorEnsembleNameInput?.focus();
    });
  }

  if (els.directorAttachBtn) {
    els.directorAttachBtn.addEventListener("click", async () => {
      const schoolId = els.directorAttachSelect?.value || "";
      if (!schoolId) return;
      const result = await attachDirectorSchool(schoolId);
      if (result?.ok) {
        const selectedSchool = state.admin.schoolsList.find((school) => school.id === schoolId);
        if (state.auth.userProfile?.role === "admin") {
          setDirectorSchoolName(selectedSchool?.name || schoolId);
        }
        updateDirectorAttachUI();
        refreshDirectorWatchers();
      }
    });
  }

  if (els.directorDetachBtn) {
    els.directorDetachBtn.addEventListener("click", async () => {
      if (state.auth.userProfile?.role === "director") {
        alertUser("School selection is locked. Contact an admin to change it.");
        return;
      }
      const ok = confirmUser("Change school? This will clear your current selection.");
      if (!ok) return;
      const result = await detachDirectorSchool();
      if (result?.ok) {
        updateDirectorAttachUI();
        setDirectorSchoolName("No school attached");
        renderDirectorEnsembles([]);
        applyDirectorEntryClear({
          hint: "Select an ensemble and event to begin.",
          status: "Draft",
          readyStatus: "disabled",
        });
        refreshDirectorWatchers();
      }
    });
  }

  if (els.directorEnsembleForm) {
    els.directorEnsembleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = els.directorEnsembleNameInput?.value.trim() || "";
      const editingEnsembleId = state.director.editingEnsembleId;
      if (!name) {
        if (els.directorEnsembleError) {
          els.directorEnsembleError.textContent = "Ensemble name is required.";
        }
        return;
      }
      if (
        !editingEnsembleId &&
        hasDirectorUnsavedChanges() &&
        !confirmUser("You have unsaved changes. Leave anyway?")
      ) {
        return;
      }
      if (els.directorEnsembleError) {
        els.directorEnsembleError.textContent = "";
      }
      const result = editingEnsembleId
        ? await renameDirectorEnsemble(editingEnsembleId, name)
        : await createDirectorEnsemble(name);
      if (result?.ok) {
        if (editingEnsembleId) {
          discardDirectorDraftChanges();
          state.director.ensemblesCache = state.director.ensemblesCache.map((ensemble) =>
            ensemble.id === editingEnsembleId ? { ...ensemble, name } : ensemble
          );
          renderDirectorEnsembles(state.director.ensemblesCache);
          updateDirectorActiveEnsembleLabel();
        } else {
          discardDirectorDraftChanges();
        }
        closeDirectorEnsembleForm();
        await loadDirectorEntry({
          onUpdate: applyDirectorEntryUpdate,
          onClear: applyDirectorEntryClear,
        });
      }
    });
  }

  if (els.directorEventSelect) {
    els.directorEventSelect.addEventListener("change", () => {
      const nextId = els.directorEventSelect?.value || null;
      if (!nextId) return;
      if (hasDirectorUnsavedChanges() && !confirmUser("You have unsaved changes. Leave anyway?")) {
        els.directorEventSelect.value = state.director.selectedEventId || "";
        if (els.directorSetEventBtn) {
          els.directorSetEventBtn.disabled = !els.directorEventSelect.value;
        }
        return;
      }
      discardDirectorDraftChanges();
      setDirectorEvent(nextId);
      updateDirectorEventMeta();
      loadDirectorEntry({
        onUpdate: applyDirectorEntryUpdate,
        onClear: applyDirectorEntryClear,
      });
      if (els.directorEventPicker) {
        els.directorEventPicker.classList.add("is-hidden");
      }
    });
  }

  if (els.directorScheduleBtn) {
    els.directorScheduleBtn.addEventListener("click", () => {
      if (!state.director.selectedEventId) return;
      if (hasDirectorUnsavedChanges() && !confirmUser("You have unsaved changes. Leave anyway?")) {
        return;
      }
      discardDirectorDraftChanges();
      window.location.hash = `#event/${state.director.selectedEventId}`;
    });
  }

  if (els.directorChangeEventBtn) {
    els.directorChangeEventBtn.addEventListener("click", () => {
      if (els.directorEventPicker) {
        const isHidden = els.directorEventPicker.classList.contains("is-hidden");
        if (
          !isHidden &&
          hasDirectorUnsavedChanges() &&
          !confirmUser("You have unsaved changes. Leave anyway?")
        ) {
          return;
        }
        els.directorEventPicker.classList.toggle("is-hidden");
      }
    });
  }


  if (els.instrumentationNonStandardAddBtn) {
    els.instrumentationNonStandardAddBtn.addEventListener("click", () => {
      if (!state.director.entryDraft) return;
      state.director.entryDraft.instrumentation.nonStandard.push({
        instrumentName: "",
        count: 0,
      });
      renderInstrumentationNonStandard();
      applyDirectorDirty("instrumentation");
    });
  }

  if (els.directorEntryReadyBtn) {
    els.directorEntryReadyBtn.addEventListener("click", async () => {
      if (!state.director.entryDraft) return;
      const isReady = state.director.entryDraft.status === "ready";
      const result = isReady ? await markEntryDraft() : await markEntryReady();
      if (!result) return;
      if (!result.ok) {
        if (result.message) {
          alertUser(result.message);
        }
        return;
      }
      const nextStatus = isReady ? "Incomplete" : "Ready";
      setDirectorEntryStatusLabel(nextStatus);
      setDirectorReadyControls({ status: isReady ? "draft" : "ready" });
      renderDirectorChecklist(
        state.director.entryDraft,
        computeDirectorCompletionState(state.director.entryDraft)
      );
    });
  }

  if (els.saveRepertoireBtn) {
    els.saveRepertoireBtn.addEventListener("click", async () => {
      els.saveRepertoireBtn.dataset.loadingLabel = "Saving...";
      els.saveRepertoireBtn.dataset.spinner = "true";
      await withLoading(els.saveRepertoireBtn, async () => {
        const result = await saveRepertoireSection();
        applyDirectorSaveResult("repertoire", result);
      });
    });
  }
  if (els.saveInstrumentationBtn) {
    els.saveInstrumentationBtn.addEventListener("click", async () => {
      els.saveInstrumentationBtn.dataset.loadingLabel = "Saving...";
      els.saveInstrumentationBtn.dataset.spinner = "true";
      await withLoading(els.saveInstrumentationBtn, async () => {
        const result = await saveInstrumentationSection();
        applyDirectorSaveResult("instrumentation", result);
      });
    });
  }
  if (els.saveNonStandardBtn) {
    els.saveNonStandardBtn.addEventListener("click", async () => {
      els.saveNonStandardBtn.dataset.loadingLabel = "Saving...";
      els.saveNonStandardBtn.dataset.spinner = "true";
      await withLoading(els.saveNonStandardBtn, async () => {
        const result = await saveInstrumentationSection();
        applyDirectorSaveResult("nonStandard", result);
      });
    });
  }
  if (els.saveRule3cBtn) {
    els.saveRule3cBtn.addEventListener("click", async () => {
      els.saveRule3cBtn.dataset.loadingLabel = "Saving...";
      els.saveRule3cBtn.dataset.spinner = "true";
      await withLoading(els.saveRule3cBtn, async () => {
        const result = await saveRule3cSection();
        applyDirectorSaveResult("rule3c", result);
      });
    });
  }
  if (els.saveSeatingBtn) {
    els.saveSeatingBtn.addEventListener("click", async () => {
      els.saveSeatingBtn.dataset.loadingLabel = "Saving...";
      els.saveSeatingBtn.dataset.spinner = "true";
      await withLoading(els.saveSeatingBtn, async () => {
        const result = await saveSeatingSection();
        applyDirectorSaveResult("seating", result);
      });
    });
  }
  if (els.savePercussionBtn) {
    els.savePercussionBtn.addEventListener("click", async () => {
      els.savePercussionBtn.dataset.loadingLabel = "Saving...";
      els.savePercussionBtn.dataset.spinner = "true";
      await withLoading(els.savePercussionBtn, async () => {
        const result = await savePercussionSection();
        applyDirectorSaveResult("percussion", result);
      });
    });
  }
  if (els.saveLunchBtn) {
    els.saveLunchBtn.addEventListener("click", async () => {
      els.saveLunchBtn.dataset.loadingLabel = "Saving...";
      els.saveLunchBtn.dataset.spinner = "true";
      await withLoading(els.saveLunchBtn, async () => {
        const result = await saveLunchSection();
        applyDirectorSaveResult("lunch", result);
      });
    });
  }

  if (els.eventDetailBackBtn) {
    els.eventDetailBackBtn.addEventListener("click", () => {
      window.location.hash = `#${state.app.currentTab || "admin"}`;
    });
  }

  if (els.eventScheduleAddSchoolSelect) {
    els.eventScheduleAddSchoolSelect.addEventListener("change", () => {
      refreshEventScheduleAddEnsembles();
    });
  }

  if (els.eventScheduleAddRowBtn) {
    els.eventScheduleAddRowBtn.addEventListener("click", async () => {
      const eventId = els.eventDetailPage?.dataset?.eventId || "";
      if (!eventId) {
        alertUser("Open an event detail page first.");
        return;
      }
      const schoolId = els.eventScheduleAddSchoolSelect?.value || "";
      const ensembleId = els.eventScheduleAddEnsembleSelect?.value || "";
      const ensembleOption = els.eventScheduleAddEnsembleSelect?.selectedOptions?.[0] || null;
      const ensembleName = ensembleOption?.dataset?.ensembleName || ensembleOption?.textContent || ensembleId;
      const sortOrder = Number(els.eventScheduleAddOrderInput?.value || 0);
      const holdingAtDate = parseLocalDateTime(els.eventScheduleAddHoldingInput?.value || "");
      const warmupAtDate = parseLocalDateTime(els.eventScheduleAddWarmupInput?.value || "");
      const performanceAtDate = parseLocalDateTime(els.eventScheduleAddPerformanceInput?.value || "");
      const sightReadingAtDate = parseLocalDateTime(els.eventScheduleAddSightInput?.value || "");

      if (!schoolId || !ensembleId) {
        alertUser("Choose a school and ensemble.");
        return;
      }
      if (!holdingAtDate || !warmupAtDate || !performanceAtDate) {
        alertUser("Holding, warm-up, and performance times are required.");
        return;
      }
      try {
        els.eventScheduleAddRowBtn.dataset.loadingLabel = "Adding...";
        els.eventScheduleAddRowBtn.dataset.spinner = "true";
        await withLoading(els.eventScheduleAddRowBtn, async () => {
          await createEventScheduleRow({
            eventId,
            schoolId,
            ensembleId,
            ensembleName,
            sortOrder: Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : 9999,
            holdingAtDate,
            warmupAtDate,
            performanceAtDate,
            sightReadingAtDate,
          });
        });
        if (els.eventScheduleAddOrderInput) els.eventScheduleAddOrderInput.value = "";
        if (els.eventScheduleAddHoldingInput) els.eventScheduleAddHoldingInput.value = "";
        if (els.eventScheduleAddWarmupInput) els.eventScheduleAddWarmupInput.value = "";
        if (els.eventScheduleAddPerformanceInput) els.eventScheduleAddPerformanceInput.value = "";
        if (els.eventScheduleAddSightInput) els.eventScheduleAddSightInput.value = "";
        if (els.eventScheduleDraftStatus) {
          els.eventScheduleDraftStatus.textContent = "Schedule row added.";
        }
      } catch (error) {
        console.error("createEventScheduleRow failed", error);
        alertUser(error?.message || "Unable to add schedule row.");
      }
    });
  }

  if (els.eventSchedulePublishBtn) {
    els.eventSchedulePublishBtn.addEventListener("click", async () => {
      const eventId = els.eventDetailPage?.dataset?.eventId || "";
      if (!eventId) return;
      try {
        els.eventSchedulePublishBtn.dataset.loadingLabel = "Publishing...";
        els.eventSchedulePublishBtn.dataset.spinner = "true";
        await withLoading(els.eventSchedulePublishBtn, async () => {
          await publishEventSchedule({ eventId });
        });
        if (els.eventScheduleDraftStatus) {
          els.eventScheduleDraftStatus.textContent = "Schedule published.";
        }
      } catch (error) {
        console.error("publishEventSchedule failed", error);
        alertUser(error?.message || "Unable to publish schedule.");
      }
    });
  }

  if (els.eventScheduleUnpublishBtn) {
    els.eventScheduleUnpublishBtn.addEventListener("click", async () => {
      const eventId = els.eventDetailPage?.dataset?.eventId || "";
      if (!eventId) return;
      if (!confirmUser("Unpublish schedule for directors?")) return;
      try {
        els.eventScheduleUnpublishBtn.dataset.loadingLabel = "Unpublishing...";
        els.eventScheduleUnpublishBtn.dataset.spinner = "true";
        await withLoading(els.eventScheduleUnpublishBtn, async () => {
          await unpublishEventSchedule({ eventId });
        });
        if (els.eventScheduleDraftStatus) {
          els.eventScheduleDraftStatus.textContent = "Schedule unpublished.";
        }
      } catch (error) {
        console.error("unpublishEventSchedule failed", error);
        alertUser(error?.message || "Unable to unpublish schedule.");
      }
    });
  }

  if (els.eventScheduleUploadBtn) {
    els.eventScheduleUploadBtn.addEventListener("click", async () => {
      const eventId = els.eventDetailPage?.dataset?.eventId || "";
      const file = els.eventScheduleFileInput?.files?.[0] || null;
      if (!eventId) {
        alertUser("Open an event detail page first.");
        return;
      }
      if (!file) {
        alertUser("Select a PDF to upload.");
        return;
      }
      els.eventScheduleUploadBtn.dataset.loadingLabel = "Uploading...";
      els.eventScheduleUploadBtn.dataset.spinner = "true";
      await withLoading(els.eventScheduleUploadBtn, async () => {
        try {
          if (els.eventScheduleStatus) {
            els.eventScheduleStatus.textContent = "Uploading schedule PDF...";
          }
          await uploadEventSchedulePdf(eventId, file);
          const event = state.event.list.find((item) => item.id === eventId) || null;
          renderEventScheduleDetail(event);
          if (els.eventScheduleStatus) {
            els.eventScheduleStatus.textContent = "Schedule PDF uploaded.";
          }
          if (els.eventScheduleFileInput) {
            els.eventScheduleFileInput.value = "";
          }
        } catch (error) {
          console.error("Event schedule upload failed", error);
          if (els.eventScheduleStatus) {
            els.eventScheduleStatus.textContent =
              error?.message || "Unable to upload schedule PDF.";
          }
        }
      });
    });
  }

  if (els.directorProfileNameInput) {
    els.directorProfileNameInput.addEventListener("input", () => {
      setDirectorProfileStatus("");
    });
  }

  if (els.directorProfileNafmeNumberInput) {
    els.directorProfileNafmeNumberInput.addEventListener("input", () => {
      setDirectorProfileStatus("");
    });
  }

  if (els.directorProfileNafmeExpInput) {
    els.directorProfileNafmeExpInput.addEventListener("change", () => {
      setDirectorProfileStatus("");
    });
  }

  if (els.directorProfileForm) {
    els.directorProfileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = els.directorProfileNameInput?.value.trim() || "";
      const nafmeNumber = els.directorProfileNafmeNumberInput?.value.trim() || "";
      const expValue = els.directorProfileNafmeExpInput?.value || "";
      try {
        setDirectorProfileStatus("Saving...");
        await saveDirectorProfile({ name, nafmeNumber, expValue });
        setDirectorProfileStatus("Saved.");
        closeDirectorProfileModal();
      } catch (error) {
        console.error("Profile save failed", error);
        setDirectorProfileStatus(
          error?.code ? `Unable to save (${error.code}).` : "Unable to save."
        );
      }
    });
  }

  if (els.directorProfileCardInput) {
    els.directorProfileCardInput.addEventListener("change", async () => {
      const file = els.directorProfileCardInput.files?.[0];
      if (!file) return;
      try {
        setDirectorProfileStatus("Uploading...");
        await uploadDirectorProfileCard(file);
        renderDirectorProfile();
        setDirectorProfileStatus("Uploaded.");
      } catch (error) {
        console.error("Profile card upload failed", error);
        setDirectorProfileStatus(
          error?.code ? `Upload failed (${error.code}).` : "Upload failed."
        );
      }
    });
  }

  if (els.directorProfileClose) {
    els.directorProfileClose.addEventListener("click", closeDirectorProfileModal);
  }
  if (els.directorProfileCancelBtn) {
    els.directorProfileCancelBtn.addEventListener("click", closeDirectorProfileModal);
  }
  if (els.directorProfileBackdrop) {
    els.directorProfileBackdrop.addEventListener("click", closeDirectorProfileModal);
  }
}

export function bindAppHandlers() {
  if (appHandlersBound) return;
  appHandlersBound = true;

  if (els.sessionExpiredSignInBtn) {
    els.sessionExpiredSignInBtn.addEventListener("click", () => {
      hideSessionExpiredModal();
      openAuthModal();
    });
  }
  if (els.sessionExpiredBackdrop) {
    els.sessionExpiredBackdrop.addEventListener("click", () => {
      showSessionExpiredModal();
    });
  }

  const openProfile = () => {
    if (!state.auth.currentUser) return;
    openUserProfileModal();
  };
  if (els.adminProfileToggleBtn) {
    els.adminProfileToggleBtn.addEventListener("click", openProfile);
  }
  if (els.judgeProfileToggleBtn) {
    els.judgeProfileToggleBtn.addEventListener("click", openProfile);
  }
  if (els.judgeOpenProfileToggleBtn) {
    els.judgeOpenProfileToggleBtn.addEventListener("click", openProfile);
  }
  if (els.userProfileClose) {
    els.userProfileClose.addEventListener("click", closeUserProfileModal);
  }
  if (els.userProfileCancelBtn) {
    els.userProfileCancelBtn.addEventListener("click", closeUserProfileModal);
  }
  if (els.userProfileBackdrop) {
    els.userProfileBackdrop.addEventListener("click", closeUserProfileModal);
  }
  if (els.userProfileForm) {
    els.userProfileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth.currentUser) return;
      const name = els.userProfileNameInput?.value.trim() || "";
      if (els.userProfileStatus) {
        els.userProfileStatus.textContent = "Saving...";
      }
      try {
        await saveUserDisplayName(name);
        updateAuthUI();
        if (els.userProfileStatus) {
          els.userProfileStatus.textContent = "Saved.";
        }
        closeUserProfileModal();
      } catch (error) {
        console.error("Profile save failed", error);
        if (els.userProfileStatus) {
          els.userProfileStatus.textContent = "Unable to save profile.";
        }
      }
    });
  }

  if (els.roleTabButtons?.length) {
    els.roleTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action || "";
        const role = getEffectiveRole(state.auth.userProfile);
        if (!role) return;
        els.roleTabButtons.forEach((btn) => {
          btn.setAttribute("aria-selected", btn === button ? "true" : "false");
        });
        switch (action) {
          case "admin-home":
            setTab("admin", { force: true });
            scrollToSection(els.adminOpenPacketsSection || els.adminSchoolsSection);
            break;
          case "admin-events":
            setTab("admin", { force: true });
            scrollToSection(els.adminOpenPacketsSection || els.adminSchoolsSection);
            break;
          case "admin-schools":
            setTab("admin", { force: true });
            scrollToSection(els.adminSchoolsSection);
            break;
          case "admin-settings":
            setTab("admin", { force: true });
            scrollToSection(els.adminSettingsSection);
            break;
          case "judge-judging":
            setTab("judge-open", { force: true });
            if (state.judgeOpen.currentPacketId) {
              showOpenDetailView();
            } else {
              hideOpenDetailView();
              scrollToSection(els.judgeOpenListView);
            }
            break;
          case "judge-schedule":
            setTab("judge-open", { force: true });
            hideOpenDetailView();
            scrollToSection(els.judgeOpenListView);
            break;
          case "judge-profile":
            openUserProfileModal();
            break;
          case "director-schedule":
            setTab("director", { force: true });
            scrollToSection(els.directorEventMeta);
            break;
          case "director-ensemble":
            setTab("director", { force: true });
            scrollToSection(els.directorEnsemblesSection);
            break;
          case "director-profile":
            openDirectorProfileModal();
            break;
          default:
            if (role === "admin") setTab("admin", { force: true });
            if (role === "judge") setTab("judge-open", { force: true });
            if (role === "director") setTab("director", { force: true });
        }
      });
    });
  }
}
