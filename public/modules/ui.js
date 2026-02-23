import {
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
  deleteEvent,
  deleteScheduleEntry,
  getPacketData,
  lockSubmission,
  lockOpenPacket,
  linkOpenPacketToEnsemble,
  provisionUser,
  releasePacket,
  releaseOpenPacket,
  saveAssignments,
  saveSchool,
  setActiveEvent,
  unreleasePacket,
  unlockOpenPacket,
  unlockSubmission,
  updateScheduleEntryTime,
  watchOpenPacketsAdmin,
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
  detachDirectorSchool,
  handleDeleteEnsemble,
  isDirectorManager,
  hasDirectorUnsavedChanges,
  loadDirectorEntry,
  markDirectorDirty,
  markEntryDraft,
  markEntryReady,
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
} from "./director.js";
import {
  calculateCaptionTotal,
  computeFinalRating,
  draftCaptionsFromTranscript,
  handleSubmit,
  markJudgeDirty,
  resetTestState,
  selectRosterEntry,
  setTestMode,
  transcribeSubmissionAudio,
  transcribeTestAudio,
  watchCurrentSubmission,
  watchAssignments,
  watchReadyEntries,
} from "./judge.js";
import {
  createOpenPacket,
  fetchOpenEnsembleIndex,
  getOpenCaptionTemplate,
  isOpenPacketEditable,
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
import { DEV_FLAGS } from "../firebase.js";
import {
  formatPerformanceAt,
  formatDateHeading,
  getEventCardLabel,
  getEventLabel,
  getSchoolNameById,
  derivePerformanceGrade,
  levelToRoman,
  normalizeCaptions,
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

function isJudgeRole(profile) {
  return getEffectiveRole(profile) === "judge";
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

function applyJudgeDirty() {
  markJudgeDirty();
}

function applySubmissionToForm(submission) {
  if (!submission || !els.captionForm) return;
  if (els.transcriptInput) {
    els.transcriptInput.value = submission.transcript || "";
  }
  state.judge.transcriptText = submission.transcript || "";
  state.judge.captions = normalizeCaptions(state.judge.formType, submission.captions || {});
  const template = CAPTION_TEMPLATES[state.judge.formType] || [];
  template.forEach(({ key }) => {
    const wrapper = els.captionForm.querySelector(`[data-key="${key}"]`);
    if (!wrapper) return;
    const selects = wrapper.querySelectorAll("select");
    const comment = wrapper.querySelector("textarea");
    const caption = state.judge.captions[key] || {};
    if (selects[0]) selects[0].value = caption.gradeLetter || "B";
    if (selects[1]) selects[1].value = caption.gradeModifier || "";
    if (comment) comment.value = caption.comment || "";
  });
  const total = calculateCaptionTotal(state.judge.captions);
  const rating = computeFinalRating(total);
  if (els.captionTotal) els.captionTotal.textContent = String(total);
  if (els.finalRating) els.finalRating.textContent = rating.label;
  renderJudgeReadiness();
}

async function startAudioCapture({ isTest = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alertUser("Recording is not supported in this browser.");
    return;
  }
  const recordBtn = isTest ? els.testRecordBtn : els.recordBtn;
  const stopBtn = isTest ? els.testStopBtn : els.stopBtn;
  const statusEl = isTest ? els.testRecordingStatus : els.recordingStatus;
  const playback = isTest ? els.testPlayback : els.playback;
  const existing = isTest ? state.judge.testMediaRecorder : state.judge.mediaRecorder;
  if (existing && existing.state === "recording") return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = MediaRecorder.isTypeSupported("audio/webm")
      ? { mimeType: "audio/webm" }
      : {};
    const recorder = new MediaRecorder(stream, options);
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (isTest) {
        state.judge.testAudioBlob = blob;
        state.judge.testRecordingChunks = [];
      } else {
        state.judge.audioBlob = blob;
        state.judge.audioDurationSec = 0;
        state.judge.recordingChunks = [];
      }
      if (playback) {
        playback.src = URL.createObjectURL(blob);
        playback.onloadedmetadata = () => {
          if (!isTest) {
            state.judge.audioDurationSec = Number(playback.duration || 0);
          }
        };
      }
    if (statusEl) {
      statusEl.textContent = "Recording saved.";
      statusEl.classList.remove("recording-active");
    }
      if (recordBtn) recordBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      stream.getTracks().forEach((track) => track.stop());
      if (isTest) {
        updateTestTranscribeState();
        renderJudgeTestReadiness();
      } else {
        updateTranscribeState();
        renderJudgeReadiness();
      }
    });
    if (isTest) {
      state.judge.testMediaRecorder = recorder;
      state.judge.testRecordingChunks = chunks;
    } else {
      state.judge.mediaRecorder = recorder;
      state.judge.recordingChunks = chunks;
      state.judge.audioBlob = null;
      state.judge.audioDurationSec = 0;
    }
    if (statusEl) {
      statusEl.textContent = "Recording...";
      statusEl.classList.add("recording-active");
    }
    if (recordBtn) recordBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    recorder.start();
  } catch (error) {
    console.error("Unable to start recording", error);
    if (statusEl) {
      statusEl.textContent = "Recording failed. Check mic permissions.";
      statusEl.classList.remove("recording-active");
    }
  }
}

function stopAudioCapture({ isTest = false } = {}) {
  const statusEl = isTest ? els.testRecordingStatus : els.recordingStatus;
  const recorder = isTest ? state.judge.testMediaRecorder : state.judge.mediaRecorder;
  if (!recorder || recorder.state !== "recording") return;
  recorder.stop();
  if (statusEl) {
    statusEl.classList.remove("recording-active");
  }
}

function applyCaptionDraft({ captions = {}, overwrite = false, isTest = false } = {}) {
  const template = CAPTION_TEMPLATES[
    isTest ? state.judge.testFormType : state.judge.formType
  ] || [];
  const root = isTest ? els.testCaptionForm : els.captionForm;
  const targetState = isTest ? state.judge.testCaptions : state.judge.captions;
  template.forEach(({ key }) => {
    const text = String(captions[key] || "").trim();
    if (!text) return;
    const existing = targetState[key]?.comment || "";
    if (!overwrite && existing) return;
    if (!targetState[key]) {
      targetState[key] = {
        gradeLetter: "B",
        gradeModifier: "",
        comment: "",
      };
    }
    targetState[key].comment = text;
    if (root) {
      const wrapper = root.querySelector(`[data-key="${key}"]`);
      const textarea = wrapper?.querySelector("textarea");
      if (textarea) textarea.value = text;
    }
  });
  if (isTest) {
    const total = calculateCaptionTotal(targetState);
    const rating = computeFinalRating(total);
    if (els.testCaptionTotal) els.testCaptionTotal.textContent = String(total);
    if (els.testFinalRating) els.testFinalRating.textContent = rating.label;
    renderJudgeTestReadiness();
  } else {
    const total = calculateCaptionTotal(targetState);
    const rating = computeFinalRating(total);
    if (els.captionTotal) els.captionTotal.textContent = String(total);
    if (els.finalRating) els.finalRating.textContent = rating.label;
    applyJudgeDirty();
    renderJudgeReadiness();
  }
}

async function handleRosterSelection(entry) {
  resetJudgeUI();
  const result = await selectRosterEntry(entry);
  if (!state.judge.isTestMode) {
    renderCaptionForm();
  }
  if (result?.submission) {
    if (els.playback && result.submission.audioUrl) {
      els.playback.src = result.submission.audioUrl;
    }
    applySubmissionToForm(result.submission);
  }
  watchCurrentSubmission((submission) => {
    lockSubmissionUI(submission);
    if (!submission) return;
    if (els.playback && submission.audioUrl) {
      els.playback.src = submission.audioUrl;
    }
    if (!state.judge.draftDirty) {
      applySubmissionToForm(submission);
    }
  });
  renderRosterList();
  if (result?.submissionHint) {
    setSubmissionHint(result.submissionHint);
  }
  if (result?.summary?.summaryData) {
    setJudgeEntrySummary(renderEntrySummary(result.summary.summaryData));
  } else if (result?.summary?.summary) {
    setJudgeEntrySummary(result.summary.summary);
  } else {
    setJudgeEntrySummary("");
  }
  if (result?.submitDisabled != null) {
    setSubmitDisabled(result.submitDisabled);
  } else {
    setSubmitDisabled(!state.event.active || !state.judge.position);
  }
  if (result?.submission) {
    lockSubmissionUI(result.submission);
  } else {
    lockSubmissionUI(null);
  }
  updateTranscribeState();
  renderJudgeReadiness();
}

async function handleDirectorEnsembleSelection(ensembleId) {
  if (!ensembleId || ensembleId === state.director.selectedEnsembleId) return;
  if (hasDirectorUnsavedChanges() && !confirmUser("You have unsaved changes. Leave anyway?")) {
    return;
  }
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
  setDirectorEntryStatusLabel(status || "Draft");
  setDirectorPerformanceGradeValue(performanceGrade || entry?.performanceGrade || "");
  setPerformanceGradeError("");
  renderDirectorChecklist(entry, completionState);
  updateDirectorReadyControlsFromState(completionState);
  if (updatedAt) {
    setDirectorEntryHint(`Last updated ${updatedAt.toLocaleString()}`);
  } else {
    setDirectorEntryHint("");
  }
}

function applyDirectorEntryClear({ hint, status, readyStatus } = {}) {
  clearDirectorEntryPanels();
  setDirectorEntryHint(hint || "");
  setDirectorEntryStatusLabel(status || "Draft");
  setDirectorReadyControls({ status: readyStatus || "disabled" });
  setDirectorPerformanceGradeValue("");
  setPerformanceGradeError("");
  renderDirectorChecklist(null, computeDirectorCompletionState(null));
}

async function submitJudgeForm(event) {
  const result = await handleSubmit(event);
  if (!result) return;
  if (!result.ok) {
    if (result.message) {
      setSubmissionHint(result.message);
    }
    return;
  }
  if (result.message) {
    setSubmissionHint(result.message);
  }
  if (result.submission) {
    lockSubmissionUI(result.submission);
  }
  renderJudgeReadiness();
  updateTranscribeState();
}

function applyDirectorSaveResult(section, result) {
  if (!result) return;
  let messageShown = false;
  if (result.ok) {
    showDirectorSectionStatus(section, result.message);
    messageShown = Boolean(result.message);
    if (result.statusChangedToDraft) {
      setDirectorEntryStatusLabel("Draft");
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
    els.directorEntryStatus.textContent = status || "Draft";
  }
  if (els.directorEntryStatusBadge) {
    els.directorEntryStatusBadge.textContent = status || "Draft";
  }
}

export function setDirectorReadyControls({ status } = {}) {
  if (!els.directorEntryReadyBtn && !els.directorEntryUndoReadyBtn) return;
  if (els.directorEntryReadyBtn) {
    if (status === "ready") {
      els.directorEntryReadyBtn.textContent = "Ready";
      els.directorEntryReadyBtn.disabled = true;
    } else if (status === "disabled") {
      els.directorEntryReadyBtn.textContent = "Mark as Ready";
      els.directorEntryReadyBtn.disabled = true;
    } else {
      els.directorEntryReadyBtn.textContent = "Mark as Ready";
      els.directorEntryReadyBtn.disabled = false;
    }
  }
  if (els.directorEntryUndoReadyBtn) {
    if (status === "ready") {
      els.directorEntryUndoReadyBtn.classList.remove("is-hidden");
    } else {
      els.directorEntryUndoReadyBtn.classList.add("is-hidden");
    }
  }
}

export function setDirectorPerformanceGradeValue(value) {
  if (!els.directorPerformanceGradeInput) return;
  els.directorPerformanceGradeInput.value = value || "";
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

export function refreshSchoolDropdowns() {
  renderSchoolOptions(els.directorSchoolSelect, "Select a school");
  renderSchoolOptions(els.directorAttachSelect, "Select a school");
  renderSchoolOptions(els.provisionSchoolSelect, "Select a school (optional)");
  renderSchoolOptions(els.scheduleSchoolSelect, "Select a school");
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
  if (state.auth.currentUser && els.headerAuthActions && els.signOutBtn.parentElement !== els.headerAuthActions) {
    els.headerAuthActions.appendChild(els.signOutBtn);
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
  updateTranscribeState();
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
    if (els.headerAuthActions && els.signOutBtn.parentElement !== els.headerAuthActions) {
      els.headerAuthActions.appendChild(els.signOutBtn);
    }
    if (els.signInBtn) {
      els.signInBtn.style.display = "none";
    }
  } else {
    els.signOutBtn.disabled = true;
    if (els.accountSummary) {
      els.accountSummary.textContent = "Signed out";
    }
    if (els.authIdentityBanner) {
      els.authIdentityBanner.classList.add("is-hidden");
    }
    if (els.modalAuthActions && els.signOutBtn.parentElement !== els.modalAuthActions) {
      els.modalAuthActions.appendChild(els.signOutBtn);
    }
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
  const hasSchool = Boolean(state.auth.userProfile?.schoolId);
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
  if (els.directorEnsemblesSection) {
    els.directorEnsemblesSection.style.display =
      isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorMainStack) {
    els.directorMainStack.style.display =
      isDirector && hasSchool ? "grid" : "none";
  }
  if (els.directorEnsembleForm) {
    els.directorEnsembleForm.classList.add("is-hidden");
  }
  if (els.directorEnsembleError) {
    els.directorEnsembleError.textContent = "";
  }
  if (els.directorProfilePanel) {
    els.directorProfilePanel.style.display = "none";
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

export function showEventDetail(eventId) {
  if (!els.eventDetailPage) return;
  const event = state.event.list.find((item) => item.id === eventId);
  if (els.eventDetailTitle) {
    els.eventDetailTitle.textContent = event?.name || "Event Details";
  }
  if (els.eventDetailMeta) {
    els.eventDetailMeta.textContent = event ? getEventLabel(event) : "Event not found.";
  }
  els.eventDetailPage.classList.remove("is-hidden");
  if (els.adminCard) els.adminCard.style.display = "none";
  if (els.judgeCard) els.judgeCard.style.display = "none";
  if (els.directorCard) els.directorCard.style.display = "none";
}

export function hideEventDetail() {
  if (!els.eventDetailPage) return;
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
  if (state.subscriptions.directorEnsembles) state.subscriptions.directorEnsembles();
  if (state.subscriptions.directorEntry) state.subscriptions.directorEntry();
  if (state.subscriptions.judges) state.subscriptions.judges();
  if (state.subscriptions.scheduleEnsembles) state.subscriptions.scheduleEnsembles();
  if (state.subscriptions.openPackets) state.subscriptions.openPackets();
  if (state.subscriptions.openSessions) state.subscriptions.openSessions();
  if (state.subscriptions.openPacketsAdmin) state.subscriptions.openPacketsAdmin();
  state.subscriptions.events = null;
  state.subscriptions.activeEvent = null;
  state.subscriptions.roster = null;
  state.subscriptions.readyEntries = null;
  state.subscriptions.assignments = null;
  state.subscriptions.judgeSubmission = null;
  state.subscriptions.directorPackets = null;
  state.subscriptions.directorOpenPackets = null;
  state.subscriptions.directorSchool = null;
  state.subscriptions.directorEnsembles = null;
  state.subscriptions.directorEntry = null;
  state.subscriptions.judges = null;
  state.subscriptions.scheduleEnsembles = null;
  state.subscriptions.openPackets = null;
  state.subscriptions.openSessions = null;
  state.subscriptions.openPacketsAdmin = null;
}

export function startWatchers() {
  stopWatchers();
  watchEvents(() => {
    renderEventList();
    renderDirectorEventOptions();
  });
  watchActiveEvent(() => {
    renderActiveEventDisplay();
    updateAdminEmptyState();
    updateJudgeEmptyState();
    renderDirectorEventOptions();
    renderAdminReadiness();
  });
  watchRoster((entries) => {
    renderRosterList();
    renderAdminScheduleList(entries);
  });
  watchAssignments((data) => {
    const positionLabel = data.position ? JUDGE_POSITION_LABELS[data.position] : "Unassigned";
    setJudgePositionDisplay(positionLabel);
    if (data.position) {
      const formLabel = data.formType === FORM_TYPES.sight ? "Sight" : "Stage";
      setJudgeAssignmentDetail(`Assigned: ${positionLabel} (${formLabel})`);
    } else {
      setJudgeAssignmentDetail("No assignment");
    }
    if (data.assignments) {
      setStageJudgeSelectValues(data.assignments);
    }
    updateJudgeEmptyState();
    if (!state.judge.isTestMode) {
      renderCaptionForm();
    }
  });
  watchSchools(() => {
    refreshSchoolDropdowns();
    if (state.auth.userProfile?.role === "judge" || state.auth.userProfile?.roles?.judge) {
      fetchOpenEnsembleIndex(state.admin.schoolsList).then((items) => {
        state.judgeOpen.existingEnsembles = items;
        renderOpenExistingOptions(items);
      });
    }
  });

  if (isDirectorManager()) {
    watchDirectorPackets(({ groups, hint } = {}) => {
      renderDirectorPackets(groups || []);
      setDirectorHint(hint || "");
    });
    watchDirectorSchool((name) => {
      setDirectorSchoolName(name);
    });
    watchDirectorEnsembles((ensembles) => {
      renderDirectorEnsembles(ensembles || []);
      updateDirectorActiveEnsembleLabel();
      loadDirectorEntry({
        onUpdate: applyDirectorEntryUpdate,
        onClear: applyDirectorEntryClear,
      });
    });
  }
  if (isJudgeRole(state.auth.userProfile)) {
    watchReadyEntries(() => {
      renderRosterList();
    });
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
  setTab("judge");
}

export function updateAdminEmptyState() {
  if (!els.adminEmpty) return;
  els.adminEmpty.style.display = state.event.active ? "none" : "block";
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
    const title = document.createElement("div");
    title.textContent = getEventCardLabel(event);
    const meta = document.createElement("div");
    meta.className = "hint";
    meta.textContent = getEventLabel(event);
    const actions = document.createElement("div");
    actions.className = "actions";

    const activeBadge = document.createElement("span");
    activeBadge.className = "badge";
    activeBadge.textContent = event.isActive ? "Active" : "Inactive";

    const activateBtn = document.createElement("button");
    activateBtn.className = "ghost";
    activateBtn.textContent = event.isActive ? "Active" : "Set Active";
    activateBtn.disabled = Boolean(event.isActive);
    activateBtn.addEventListener("click", async () => {
      await setActiveEvent(event.id);
    });

    const detailBtn = document.createElement("button");
    detailBtn.className = "ghost";
    detailBtn.textContent = "View Details";
    detailBtn.addEventListener("click", () => {
      window.location.hash = `#event/${event.id}`;
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!confirmUser("Delete this event? This cannot be undone.")) return;
      await deleteEvent(event.id);
    });

    actions.appendChild(activeBadge);
    actions.appendChild(activateBtn);
    actions.appendChild(detailBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(title);
    li.appendChild(meta);
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

export function updateJudgeEmptyState() {
  if (!els.judgeEmpty) return;
  const show = !state.event.active || !state.judge.position;
  els.judgeEmpty.style.display = show ? "block" : "none";
  if (els.judgeStatusBadge) {
    if (!state.event.active) {
      els.judgeStatusBadge.textContent = "No active event";
    } else if (!state.judge.position) {
      els.judgeStatusBadge.textContent = "No assignment";
    } else {
      els.judgeStatusBadge.textContent = "Assigned";
    }
  }
  renderJudgeReadiness();
}

export function setSubmissionHint(message) {
  if (!els.submissionHint) return;
  els.submissionHint.textContent = message || "";
}

export function setJudgeEntrySummary(message) {
  if (!els.judgeEntrySummary) return;
  els.judgeEntrySummary.textContent = message || "";
}

export function setJudgePositionDisplay(message) {
  if (!els.judgePositionDisplay) return;
  els.judgePositionDisplay.textContent = message || "";
}

export function setJudgeAssignmentDetail(message) {
  if (!els.judgeAssignmentDetail) return;
  els.judgeAssignmentDetail.textContent = message || "";
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
    card.innerHTML = `
      <div class="packet-card-header">
        <div class="packet-card-title">${packet.schoolName || "Unknown school"} • ${packet.ensembleName || "Unknown ensemble"}</div>
        <span class="status-badge">${status}</span>
      </div>
      <div class="packet-card-meta">${formatPacketUpdatedAt(packet)}</div>
      <div class="progress-bar"><span style="width: ${progress}%"></span></div>
    `;
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
  els.judgeOpenHeaderTitle.textContent = `${school} • ${ensemble}`;
  els.judgeOpenHeaderSub.textContent = packet.status || "Draft";
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
  if (els.judgeOpenDetailView) {
    els.judgeOpenDetailView.classList.add("is-open");
  }
}

function hideOpenDetailView() {
  if (els.judgeOpenDetailView) {
    els.judgeOpenDetailView.classList.remove("is-open");
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
      <div class="caption-title">${label}</div>
      <div class="caption-segments" data-grade-group>
        <button type="button" data-grade="A">A</button>
        <button type="button" data-grade="B">B</button>
        <button type="button" data-grade="C">C</button>
        <button type="button" data-grade="D">D</button>
        <button type="button" data-grade="F">F</button>
      </div>
      <div class="caption-modifiers" data-modifier-group>
        <button type="button" data-modifier="+">+</button>
        <button type="button" data-modifier="-">-</button>
      </div>
      <textarea rows="2" data-comment></textarea>
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
    const startedText = startedAtLabel ? ` • ${startedAtLabel}` : "";
    hint.textContent = `${status} • ${duration}${startedText} • transcript ${transcriptStatus}${
      session.needsUpload ? " • needs upload" : ""
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
  if (!isJudgeRole(state.auth.userProfile)) return;
  const local = loadOpenPrefs();
  const prefs = state.auth.userProfile?.preferences || {};
  const defaultFormType = prefs.judgeOpenDefaultFormType || local.defaultFormType || "stage";
  const lastFormType = prefs.lastJudgeOpenFormType || local.lastFormType || defaultFormType;
  state.judgeOpen.formType = lastFormType || "stage";
  if (els.judgeOpenFormTypeSelect) {
    els.judgeOpenFormTypeSelect.value = state.judgeOpen.formType;
  }
  syncOpenFormTypeSegmented();
  renderOpenCaptionForm();

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
  packets.forEach((packet) => {
    const item = document.createElement("li");
    item.className = "list-item";
    const meta = document.createElement("div");
    meta.className = "stack";
    const title = document.createElement("strong");
    const school = packet.schoolName || packet.schoolId || "Unknown school";
    const ensemble = packet.ensembleName || packet.ensembleId || "Unknown ensemble";
    title.textContent = `${school} • ${ensemble}`;
    const detail = document.createElement("div");
    detail.className = "note";
    detail.textContent = `Status: ${packet.status || "draft"}`;
    meta.appendChild(title);
    meta.appendChild(detail);
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";
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
    releaseBtn.textContent = packet.status === "released" ? "Released" : "Release";
    releaseBtn.disabled = packet.status === "released";
    releaseBtn.addEventListener("click", async () => {
      if (packet.status === "released") return;
      await releaseOpenPacket({ packetId: packet.id });
    });
    actions.appendChild(releaseBtn);

    const linkBtn = document.createElement("button");
    linkBtn.className = "ghost";
    linkBtn.textContent = "Link Ensemble";
    linkBtn.addEventListener("click", async () => {
      const schoolId = window.prompt("School ID to link:");
      if (!schoolId) return;
      const ensembleId = window.prompt("Ensemble ID to link:");
      if (!ensembleId) return;
      await linkOpenPacketToEnsemble({ packetId: packet.id, schoolId, ensembleId });
    });
    actions.appendChild(linkBtn);

    item.appendChild(actions);
    els.adminOpenPacketsList.appendChild(item);
  });
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

export function setSubmitDisabled(disabled) {
  if (!els.submitBtn) return;
  els.submitBtn.disabled = Boolean(disabled);
  els.submitBtn.dataset.locked = disabled ? "true" : "false";
}

export function resetJudgeUI() {
  if (els.submissionForm) els.submissionForm.reset?.();
  if (els.recordingStatus) els.recordingStatus.textContent = "";
  if (els.playback) els.playback.src = "";
  if (els.transcriptInput) els.transcriptInput.value = "";
  if (els.captionForm) els.captionForm.innerHTML = "";
  if (els.captionTotal) els.captionTotal.textContent = "0";
  if (els.finalRating) els.finalRating.textContent = "N/A";
  if (els.submitBtn) {
    els.submitBtn.disabled = false;
    els.submitBtn.dataset.locked = "false";
  }
}

export function resetTestUI() {
  if (els.testRecordingStatus) els.testRecordingStatus.textContent = "";
  if (els.testPlayback) els.testPlayback.src = "";
  if (els.testTranscriptInput) els.testTranscriptInput.value = "";
  if (els.testCaptionForm) els.testCaptionForm.innerHTML = "";
  if (els.testCaptionTotal) els.testCaptionTotal.textContent = "0";
  if (els.testFinalRating) els.testFinalRating.textContent = "N/A";
}

export function setTestModeUI(isEnabled) {
  if (els.testModeToggle) {
    els.testModeToggle.textContent = isEnabled ? "Exit Test Mode" : "Enter Test Mode";
  }
  if (els.testModeContent) {
    els.testModeContent.classList.toggle("is-hidden", !isEnabled);
  }
  if (els.testFormTypeSelect) {
    els.testFormTypeSelect.disabled = !isEnabled;
  }
  if (els.judgeTestBadge) {
    els.judgeTestBadge.classList.toggle("is-hidden", !isEnabled);
  }
}

export function setTestFormTypeValue(value) {
  if (!els.testFormTypeSelect) return;
  els.testFormTypeSelect.value = value || "stage";
}

export function updateTranscribeState() {
  if (!els.transcribeBtn) return;
  if (els.submitBtn?.dataset.locked === "true") {
    els.transcribeBtn.disabled = true;
    return;
  }
  if (state.app.isOffline) {
    els.transcribeBtn.disabled = true;
    return;
  }
  const hasLocalAudio = Boolean(state.judge.audioBlob);
  const ready =
    !!state.auth.currentUser &&
    !!state.event.active &&
    !!state.judge.selectedRosterEntry &&
    !!state.judge.position &&
    (state.judge.currentSubmissionHasAudio || hasLocalAudio);
  els.transcribeBtn.disabled = !ready;
  els.transcribeBtn.title = ready
    ? ""
    : "Record audio and select an ensemble to enable transcription.";
  renderJudgeReadiness();
}

export function updateTestTranscribeState() {
  if (!els.testTranscribeBtn) return;
  els.testTranscribeBtn.disabled = !state.judge.testAudioBlob;
  renderJudgeTestReadiness();
}

export function lockSubmissionUI(submissionData) {
  const isSubmitted = submissionData?.status === STATUSES.submitted;
  const isLocked = Boolean(submissionData?.locked);
  if (els.submissionSubmittedBadge) {
    els.submissionSubmittedBadge.classList.toggle("is-hidden", !isSubmitted);
  }
  if (els.submissionSubmittedAt) {
    if (isSubmitted && submissionData?.submittedAt?.toDate) {
      els.submissionSubmittedAt.textContent = `Submitted ${submissionData.submittedAt.toDate().toLocaleString()}`;
    } else {
      els.submissionSubmittedAt.textContent = "";
    }
  }
  if (els.submissionForm) {
    const controls = els.submissionForm.querySelectorAll("input, textarea, select, button");
    controls.forEach((el) => {
      el.disabled = isSubmitted && isLocked;
    });
  }
  if (els.recordBtn) {
    els.recordBtn.style.display = isSubmitted && isLocked ? "none" : "";
    if (!isSubmitted || !isLocked) els.recordBtn.disabled = false;
  }
  if (els.stopBtn) {
    els.stopBtn.style.display = isSubmitted && isLocked ? "none" : "";
    if (!isSubmitted || !isLocked) els.stopBtn.disabled = true;
  }
  if (els.submitBtn) {
    els.submitBtn.style.display = isSubmitted && isLocked ? "none" : "";
    if (isSubmitted && isLocked) {
      els.submitBtn.dataset.locked = "true";
    } else {
      els.submitBtn.dataset.locked = "false";
    }
    if ((!isSubmitted || !isLocked) && !state.app.isOffline) {
      els.submitBtn.disabled = false;
    }
  }
  if (!isSubmitted || !isLocked) {
    updateTranscribeState();
  }
}

export function renderDirectorEventOptions() {
  if (!els.directorEventSelect) return;
  els.directorEventSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select an event";
  els.directorEventSelect.appendChild(placeholder);
  state.event.list.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = getEventCardLabel(event);
    els.directorEventSelect.appendChild(option);
  });
  const exists = state.event.list.some((event) => event.id === state.director.selectedEventId);
  if (!exists) {
    state.director.selectedEventId = state.event.active?.id || state.event.list[0]?.id || null;
  }
  if (state.director.selectedEventId) {
    els.directorEventSelect.value = state.director.selectedEventId;
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
  const level = state.director.entryDraft.repertoire?.[key]?.gradeLevel;
  const roman = level ? levelToRoman(level) : "";
  const title = state.director.entryDraft.repertoire?.[key]?.titleText || "";
  if (roman && title) {
    preview.textContent = `Preview: ${roman} ${title}`;
  } else if (title) {
    preview.textContent = `Preview: ${title}`;
  } else {
    preview.textContent = "";
  }
}

export function renderRepertoireFields() {
  if (!els.repertoireFields || !state.director.entryDraft) return;
  els.repertoireFields.innerHTML = "";
  if (!state.director.entryDraft.repertoire) {
    state.director.entryDraft.repertoire = {};
  }
  const repertoire = state.director.entryDraft.repertoire;
  REPERTOIRE_FIELDS.forEach((piece) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
    if (!repertoire[piece.key]) {
      repertoire[piece.key] = {
        titleText: "",
        composerArrangerText: "",
        workId: null,
        catalogSource: null,
      };
      if (piece.key !== "march") {
        repertoire[piece.key].gradeLevel = null;
      }
    }
    const pieceData = repertoire[piece.key];
    let gradeSelect = null;
    let titleInput = null;
    if (piece.key !== "march") {
      const row = document.createElement("div");
      row.className = "repertoire-row";

      const gradeLabel = document.createElement("label");
      gradeLabel.textContent = "Grade";
      const gradeSelectEl = document.createElement("select");
      gradeLabel.appendChild(gradeSelectEl);
      gradeSelect = gradeSelectEl;
      const baseOption = document.createElement("option");
      baseOption.value = "";
      baseOption.textContent = "Grade";
      gradeSelect.appendChild(baseOption);
      ["I", "II", "III", "IV", "V", "VI"].forEach((roman, index) => {
        const option = document.createElement("option");
        option.value = String(index + 1);
        option.textContent = roman;
        gradeSelect.appendChild(option);
      });
      const currentLevel = pieceData?.gradeLevel;
      gradeSelect.value = currentLevel ? String(currentLevel) : "";
      gradeSelect.addEventListener("change", () => {
        const level = gradeSelect.value ? Number(gradeSelect.value) : null;
        pieceData.gradeLevel = level;
        applyDirectorDirty("repertoire");
        updateRepertoirePreview(wrapper, piece.key);
        const derived = derivePerformanceGrade(
          state.director.entryDraft.repertoire?.selection1?.gradeLevel,
          state.director.entryDraft.repertoire?.selection2?.gradeLevel
        );
        if (derived.ok) {
          state.director.entryDraft.performanceGrade = derived.value;
          if (els.directorPerformanceGradeInput) {
            els.directorPerformanceGradeInput.value = derived.value;
          }
          setPerformanceGradeError("");
        }
      });

      const titleLabel = document.createElement("label");
      titleLabel.textContent = `${piece.label} Title`;
      const titleInputEl = document.createElement("input");
      titleInputEl.type = "text";
      titleLabel.appendChild(titleInputEl);
      titleInput = titleInputEl;
      titleInput.value = pieceData?.titleText || "";
      titleInput.addEventListener("input", () => {
        pieceData.titleText = titleInput.value.trim();
        applyDirectorDirty("repertoire");
        updateRepertoirePreview(wrapper, piece.key);
      });

      row.appendChild(gradeLabel);
      row.appendChild(titleLabel);
      wrapper.appendChild(row);
    } else {
      const titleLabel = document.createElement("label");
      titleLabel.textContent = `${piece.label} Title`;
      const titleInputEl = document.createElement("input");
      titleInputEl.type = "text";
      titleLabel.appendChild(titleInputEl);
      titleInput = titleInputEl;
      titleInput.value = pieceData?.titleText || "";
      titleInput.addEventListener("input", () => {
        pieceData.titleText = titleInput.value.trim();
        applyDirectorDirty("repertoire");
      });
      wrapper.appendChild(titleLabel);
    }

    const composerLabel = document.createElement("label");
    composerLabel.textContent = `${piece.label} Composer/Arranger`;
    const composerInputEl = document.createElement("input");
    composerInputEl.type = "text";
    composerLabel.appendChild(composerInputEl);
    const composerInput = composerInputEl;
    composerInput.value = pieceData?.composerArrangerText || "";
    composerInput.addEventListener("input", () => {
      pieceData.composerArrangerText = composerInput.value.trim();
      applyDirectorDirty("repertoire");
    });

    wrapper.appendChild(composerLabel);
    if (piece.key !== "march") {
      const preview = document.createElement("div");
      preview.className = "hint";
      preview.dataset.previewKey = piece.key;
      wrapper.appendChild(preview);
      updateRepertoirePreview(wrapper, piece.key);
    }
    els.repertoireFields.appendChild(wrapper);
  });
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
    els.directorPerformanceGradeInput.value =
      state.director.entryDraft.performanceGrade || "";
    els.directorPerformanceGradeInput.oninput = null;
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
    };
  }
  if (els.lunchNotesInput) {
    els.lunchNotesInput.value = state.director.entryDraft.lunchOrder?.notes || "";
    els.lunchNotesInput.oninput = () => {
      state.director.entryDraft.lunchOrder.notes = els.lunchNotesInput.value || "";
      applyDirectorDirty("lunch");
    };
  }

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
    pillText: done === total ? "Complete" : "Draft",
    hintText: done === total ? "" : `${total - done} missing`,
  });

  if (els.directorSummaryStatus) {
    els.directorSummaryStatus.textContent = done === total ? "Ready" : "Draft";
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
  const hasSchedule = hasEvent && state.event.rosterEntries.length > 0;
  const items = [
    { key: "event", label: "Active event" },
    { key: "assignments", label: "Judge assignments" },
    { key: "schedule", label: "Schedule loaded" },
  ];
  const status = {
    event: hasEvent,
    assignments: hasAssignments,
    schedule: hasSchedule,
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

export function renderJudgeReadiness() {
  if (!els.judgeReadinessChecklist) return;
  const hasRoster = Boolean(state.judge.selectedRosterEntry);
  const hasAudio = state.judge.currentSubmissionHasAudio || Boolean(state.judge.audioBlob);
  const transcriptReady = Boolean(els.transcriptInput?.value.trim());
  const template = CAPTION_TEMPLATES[state.judge.formType] || [];
  const captionsReady =
    template.length > 0 &&
    template.every(({ key }) => Boolean(state.judge.captions[key]?.gradeLetter));
  const items = [
    { key: "roster", label: "Ensemble selected" },
    { key: "audio", label: "Recording captured" },
    { key: "transcript", label: "Transcript drafted" },
    { key: "captions", label: "Captions scored" },
  ];
  const status = {
    roster: hasRoster,
    audio: hasAudio,
    transcript: transcriptReady,
    captions: captionsReady,
  };
  const total = items.length;
  const done = items.filter((item) => Boolean(status[item.key])).length;

  renderStatusSummary({
    rootId: "judgeReadinessPanel",
    title: done === total ? "Ready to submit" : "Submission in progress",
    done,
    total,
    pillText: done === total ? "Complete" : "Draft",
    hintText: done === total ? "" : `${total - done} missing`,
  });

  renderChecklist(els.judgeReadinessChecklist, items, status);
}

export function renderJudgeTestReadiness() {
  if (!els.judgeTestReadinessChecklist) return;
  const hasAudio = Boolean(state.judge.testAudioBlob);
  const transcriptReady = Boolean(els.testTranscriptInput?.value.trim());
  const template = CAPTION_TEMPLATES[state.judge.testFormType] || [];
  const captionsReady =
    template.length > 0 &&
    template.every(({ key }) => Boolean(state.judge.testCaptions[key]?.gradeLetter));
  const items = [
    { key: "audio", label: "Recording captured" },
    { key: "transcript", label: "Transcript drafted" },
    { key: "captions", label: "Captions scored" },
  ];
  const status = {
    audio: hasAudio,
    transcript: transcriptReady,
    captions: captionsReady,
  };
  const total = items.length;
  const done = items.filter((item) => Boolean(status[item.key])).length;

  renderStatusSummary({
    rootId: "judgeTestReadinessPanel",
    title: done === total ? "Test run complete" : "Test in progress",
    done,
    total,
    pillText: done === total ? "Complete" : "Draft",
    hintText: done === total ? "" : `${total - done} missing`,
  });

  renderChecklist(els.judgeTestReadinessChecklist, items, status);
}

export function updateDirectorActiveEnsembleLabel() {
  if (!els.directorActiveEnsembleName) return;
  const active = state.director.ensemblesCache.find(
    (ensemble) => ensemble.id === state.director.selectedEnsembleId
  );
  els.directorActiveEnsembleName.textContent =
    active?.name || "None selected";
}

export function renderEntrySummary(entry) {
  if (!entry) return "";
  const standard = entry.instrumentation?.standardCounts || {};
  const standardSummary = STANDARD_INSTRUMENTS.map((inst) => {
    const count = Number(standard[inst.key] || 0);
    return count ? `${inst.label}: ${count}` : null;
  }).filter(Boolean);
  const nonStandard = (entry.instrumentation?.nonStandard || [])
    .filter((row) => row.instrumentName)
    .map((row) => `${row.instrumentName}: ${row.count || 0}`);
  const otherNotes = entry.instrumentation?.otherInstrumentationNotes || "";
  const totalPerc = entry.instrumentation?.totalPercussion ?? 0;
  const lines = [];
  if (standardSummary.length) lines.push(`Standard: ${standardSummary.join(", ")}`);
  lines.push(`Total Percussion: ${totalPerc}`);
  if (nonStandard.length) lines.push(`Non-standard: ${nonStandard.join(", ")}`);
  if (otherNotes.trim()) lines.push(`Notes: ${otherNotes.trim()}`);
  return lines.join(" • ");
}

export function renderCaptionForm() {
  els.captionForm.innerHTML = "";
  if (!state.judge.formType) return;
  const template = CAPTION_TEMPLATES[state.judge.formType] || [];
  template.forEach(({ key, label }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
    wrapper.dataset.key = key;

    const title = document.createElement("div");
    title.textContent = label;
    title.className = "note";

    const row = document.createElement("div");
    row.className = "row";

    const gradeSelect = document.createElement("select");
    ["A", "B", "C", "D", "F"].forEach((grade) => {
      const option = document.createElement("option");
      option.value = grade;
      option.textContent = grade;
      gradeSelect.appendChild(option);
    });

    const modifierSelect = document.createElement("select");
    ["", "+", "-"].forEach((mod) => {
      const option = document.createElement("option");
      option.value = mod;
      option.textContent = mod === "" ? "(none)" : mod;
      modifierSelect.appendChild(option);
    });

    const comment = document.createElement("textarea");
    comment.rows = 2;
    comment.placeholder = "Notes";

    const updateCaptionState = (skipDirty = false) => {
      state.judge.captions[key] = {
        gradeLetter: gradeSelect.value,
        gradeModifier: modifierSelect.value,
        comment: comment.value.trim(),
      };
      const total = calculateCaptionTotal(state.judge.captions);
      const rating = computeFinalRating(total);
      els.captionTotal.textContent = String(total);
      els.finalRating.textContent = rating.label;
      renderJudgeReadiness();
      if (!skipDirty) {
        applyJudgeDirty();
      }
    };

    gradeSelect.addEventListener("change", updateCaptionState);
    modifierSelect.addEventListener("change", updateCaptionState);
    comment.addEventListener("input", updateCaptionState);

    row.appendChild(gradeSelect);
    row.appendChild(modifierSelect);
    wrapper.appendChild(title);
    wrapper.appendChild(row);
    wrapper.appendChild(comment);
    els.captionForm.appendChild(wrapper);

    gradeSelect.value = "B";
    updateCaptionState(true);
  });
}

export function renderTestCaptionForm() {
  if (!els.testCaptionForm) return;
  els.testCaptionForm.innerHTML = "";
  const template = CAPTION_TEMPLATES[state.judge.testFormType] || [];
  template.forEach(({ key, label }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
    wrapper.dataset.key = key;

    const title = document.createElement("div");
    title.textContent = label;
    title.className = "note";

    const row = document.createElement("div");
    row.className = "row";

    const gradeSelect = document.createElement("select");
    ["A", "B", "C", "D", "F"].forEach((grade) => {
      const option = document.createElement("option");
      option.value = grade;
      option.textContent = grade;
      gradeSelect.appendChild(option);
    });

    const modifierSelect = document.createElement("select");
    ["", "+", "-"].forEach((mod) => {
      const option = document.createElement("option");
      option.value = mod;
      option.textContent = mod === "" ? "(none)" : mod;
      modifierSelect.appendChild(option);
    });

    const comment = document.createElement("textarea");
    comment.rows = 2;
    comment.placeholder = "Notes";

    const updateCaptionState = () => {
      state.judge.testCaptions[key] = {
        gradeLetter: gradeSelect.value,
        gradeModifier: modifierSelect.value,
        comment: comment.value.trim(),
      };
      const total = calculateCaptionTotal(state.judge.testCaptions);
      const rating = computeFinalRating(total);
      if (els.testCaptionTotal) {
        els.testCaptionTotal.textContent = String(total);
      }
      if (els.testFinalRating) {
        els.testFinalRating.textContent = rating.label;
      }
      renderJudgeTestReadiness();
    };

    gradeSelect.addEventListener("change", updateCaptionState);
    modifierSelect.addEventListener("change", updateCaptionState);
    comment.addEventListener("input", updateCaptionState);

    row.appendChild(gradeSelect);
    row.appendChild(modifierSelect);
    wrapper.appendChild(title);
    wrapper.appendChild(row);
    wrapper.appendChild(comment);
    els.testCaptionForm.appendChild(wrapper);

    gradeSelect.value = "B";
    updateCaptionState();
  });
}

export function renderRosterList() {
  const search = (els.rosterSearch?.value || "").trim().toLowerCase();
  const readyOnly = state.auth.userProfile?.role === "judge";
  const readySet = state.event.readyEnsembles || new Set();
  const filtered = state.event.rosterEntries.filter((entry) => {
    if (readyOnly && !readySet.has(entry.ensembleId)) return false;
    if (!search) return true;
    const timeLabel = formatPerformanceAt(entry.performanceAt) || "";
    const searchText = [entry.schoolId, entry.ensembleId, entry.ensembleName, timeLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchText.includes(search);
  });

  els.rosterList.innerHTML = "";
  if (!filtered.length) {
    const li = document.createElement("li");
    li.className = "note";
    li.textContent = "No ready ensembles yet.";
    els.rosterList.appendChild(li);
    return;
  }
  const MAX_ROSTER_ROWS = 50;
  const visible = filtered.slice(0, MAX_ROSTER_ROWS);
  visible.forEach((entry) => {
    const performanceLabel = formatPerformanceAt(entry.performanceAt);
    const schoolName =
      entry.schoolName || getSchoolNameById(state.admin.schoolsList, entry.schoolId);
    const ensembleName = entry.ensembleName || entry.ensembleId || "Ensemble";
    const selectedId = state.judge.selectedRosterEntry?.id || state.judge.selectedRosterEntry?.ensembleId;
    const entryId = entry.id || entry.ensembleId;
    const isSelected = selectedId && entryId === selectedId;
    const li = document.createElement("li");
    if (isSelected) {
      li.classList.add("is-selected");
    }
    const top = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = performanceLabel || "Missing datetime";
    top.appendChild(strong);
    top.appendChild(document.createTextNode(` - ${schoolName} — ${ensembleName}`));
    if (isSelected) {
      const badge = document.createElement("span");
      badge.className = "roster-selected-badge";
      badge.textContent = "Selected";
      top.appendChild(badge);
    }
    li.appendChild(top);
    const selectBtn = document.createElement("button");
    selectBtn.textContent = isSelected ? "Selected" : "Select";
    selectBtn.disabled = isSelected;
    selectBtn.addEventListener("click", () => handleRosterSelection(entry));
    li.appendChild(selectBtn);
    els.rosterList.appendChild(li);
  });
  if (filtered.length > MAX_ROSTER_ROWS) {
    const li = document.createElement("li");
    li.className = "note";
    li.textContent = `Showing ${MAX_ROSTER_ROWS} of ${filtered.length}. Refine your search to narrow results.`;
    els.rosterList.appendChild(li);
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
  els.scheduleList.innerHTML = "";
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

export function renderSubmissionCard(submission, position) {
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
  badge.textContent = JUDGE_POSITION_LABELS[position];
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
    ? `${judgeName} • ${judgeEmail}`
    : judgeName || judgeEmail || "Unknown judge";
  judgeInfo.textContent = `${judgeLabel}${judgeTitle ? ` • ${judgeTitle}` : ""}${judgeAffiliation ? ` • ${judgeAffiliation}` : ""}`;

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.className = "audio";
  if (submission.audioUrl) {
    audio.src = submission.audioUrl;
  }

  const captionSummary = document.createElement("div");
  captionSummary.className = "caption-grid";
  const captions = submission.captions || {};
  Object.entries(captions).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "caption-row";
    const gradeDisplay = `${value.gradeLetter || ""}${value.gradeModifier || ""}`;
    const title = document.createElement("strong");
    title.textContent = key;
    const grade = document.createElement("div");
    grade.textContent = `Grade: ${gradeDisplay}`;
    const comment = document.createElement("div");
    comment.textContent = value.comment || "";
    row.appendChild(title);
    row.appendChild(grade);
    row.appendChild(comment);
    captionSummary.appendChild(row);
  });

  const transcript = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Transcript";
  transcript.appendChild(summary);
  const transcriptBody = document.createElement("div");
  transcriptBody.className = "note";
  transcriptBody.textContent = submission.transcript || "No transcript.";
  transcript.appendChild(transcriptBody);

  const footer = document.createElement("div");
  footer.className = "note";
  footer.textContent = `Caption Total: ${submission.captionScoreTotal || 0} • Final Rating: ${submission.computedFinalRatingLabel || "N/A"}`;

  card.appendChild(header);
  card.appendChild(judgeInfo);
  card.appendChild(audio);
  card.appendChild(captionSummary);
  card.appendChild(transcript);
  card.appendChild(footer);

  return card;
}

export async function loadAdminPacketView(entry, packetPanel) {
  if (!packetPanel) return;
  packetPanel.innerHTML = "Loading packet...";
  if (!state.event.active) {
    packetPanel.textContent = "No active event.";
    return;
  }
  try {
    const { grade, directorName, submissions, summary } = await getPacketData({
      eventId: state.event.active.id,
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
        await releasePacket({ eventId: state.event.active.id, ensembleId: entry.ensembleId });
      } else {
        await unreleasePacket({ eventId: state.event.active.id, ensembleId: entry.ensembleId });
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
              eventId: state.event.active.id,
              ensembleId: entry.ensembleId,
              judgePosition: position,
            });
          } else {
            await lockSubmission({
              eventId: state.event.active.id,
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
      header.appendChild(ensembleRow);
      header.appendChild(schoolRow);
      header.appendChild(ensembleNameRow);
      header.appendChild(ratingRow);

      const grid = document.createElement("div");
      grid.className = "packet-grid";
      const transcriptCard = document.createElement("div");
      transcriptCard.className = "packet-card";
      const transcriptBadge = document.createElement("div");
      transcriptBadge.className = "badge";
      transcriptBadge.textContent = "Transcript";
      const transcriptText = document.createElement("div");
      transcriptText.className = "note";
      transcriptText.textContent = group.transcript
        ? group.transcript
        : "Transcript not available.";
      transcriptCard.appendChild(transcriptBadge);
      transcriptCard.appendChild(transcriptText);
      grid.appendChild(transcriptCard);

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
        grid.appendChild(renderSubmissionCard(submission, position));
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
    const details = document.createElement("div");
    const name = document.createElement("div");
    name.className = "ensemble-name";
    name.textContent = ensemble.name || "Untitled";
    const badge = document.createElement("div");
    badge.className = "badge-active";
    badge.textContent = isActive ? "Active Ensemble" : "";
    details.appendChild(name);
    details.appendChild(badge);
    li.appendChild(details);
    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.textContent = ensemble.id === state.director.selectedEnsembleId ? "Active" : "Set Active";
    selectBtn.className = ensemble.id === state.director.selectedEnsembleId ? "ghost" : "";
    selectBtn.disabled = ensemble.id === state.director.selectedEnsembleId;
    selectBtn.addEventListener("click", () => handleDirectorEnsembleSelection(ensemble.id));
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
    actions.appendChild(selectBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);
    els.directorEnsembleList.appendChild(li);
  });
}

let adminHandlersBound = false;
let judgeHandlersBound = false;
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

  if (els.createEventBtn) {
    els.createEventBtn.addEventListener("click", async () => {
      const name = els.eventNameInput?.value.trim() || "";
      const startValue = els.eventStartAtInput?.value || "";
      const endValue = els.eventEndAtInput?.value || "";
      if (!name || !startValue || !endValue) {
        alertUser("Enter a name, start time, and end time.");
        return;
      }
      const startAtDate = new Date(startValue);
      const endAtDate = new Date(endValue);
      await createEvent({ name, startAtDate, endAtDate });
      if (els.eventNameInput) els.eventNameInput.value = "";
      if (els.eventStartAtInput) els.eventStartAtInput.value = "";
      if (els.eventEndAtInput) els.eventEndAtInput.value = "";
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
      const schoolId = els.schoolIdCreateInput?.value.trim() || "";
      const name = els.schoolNameCreateInput?.value.trim() || "";
      if (!schoolId || !name) {
        alertUser("Enter a school ID and name.");
        return;
      }
      await saveSchool({ schoolId, name });
      els.schoolIdCreateInput.value = "";
      els.schoolNameCreateInput.value = "";
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

export function bindJudgeHandlers() {
  if (judgeHandlersBound) return;
  judgeHandlersBound = true;

  if (els.submissionForm) {
    els.submissionForm.addEventListener("submit", submitJudgeForm);
  }

  if (els.transcriptInput) {
    els.transcriptInput.addEventListener("input", () => {
      state.judge.transcriptText = els.transcriptInput.value || "";
      applyJudgeDirty();
      renderJudgeReadiness();
    });
  }

  if (els.testTranscriptInput) {
    els.testTranscriptInput.addEventListener("input", () => {
      state.judge.testTranscriptText = els.testTranscriptInput.value || "";
      renderJudgeTestReadiness();
    });
  }

  if (els.testModeToggle) {
    els.testModeToggle.addEventListener("click", () => {
      const result = setTestMode(!state.judge.isTestMode);
      setTestModeUI(result.isTestMode);
      setTestFormTypeValue(state.judge.testFormType);
      if (result.isTestMode) {
        renderTestCaptionForm();
      } else if (result.hasSelection) {
        renderCaptionForm();
      }
      updateTranscribeState();
    });
  }

  if (els.testFormTypeSelect) {
    els.testFormTypeSelect.addEventListener("change", () => {
      state.judge.testFormType = els.testFormTypeSelect.value || "stage";
      if (state.judge.isTestMode) {
        const result = setTestMode(true);
        setTestModeUI(result.isTestMode);
        setTestFormTypeValue(state.judge.testFormType);
        renderTestCaptionForm();
      }
    });
  }

  if (els.testClearBtn) {
    els.testClearBtn.addEventListener("click", () => {
      resetTestState();
      resetTestUI();
      renderTestCaptionForm();
    });
  }

  if (els.testDraftBtn) {
    els.testDraftBtn.addEventListener("click", async () => {
      const transcript = state.judge.testTranscriptText || "";
      if (!transcript.trim()) {
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Add a transcript before drafting captions.";
        }
        return;
      }
      if (!state.judge.testFormType) {
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Select a form type before drafting.";
        }
        return;
      }
      if (!els.testCaptionForm?.children?.length) {
        renderTestCaptionForm();
      }
      els.testDraftBtn.dataset.loadingLabel = "Drafting...";
      els.testDraftBtn.dataset.spinner = "true";
      await withLoading(els.testDraftBtn, async () => {
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Drafting captions. Please wait...";
        }
        const result = await draftCaptionsFromTranscript({
          transcript,
          formType: state.judge.testFormType,
        });
        if (!result?.ok) {
          if (els.testRecordingStatus) {
            els.testRecordingStatus.textContent =
              result?.message || "Unable to draft captions.";
          }
          return;
        }
        applyCaptionDraft({ captions: result.captions, overwrite: true, isTest: true });
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Drafted captions.";
        }
      });
    });
  }

  if (els.draftBtn) {
    els.draftBtn.addEventListener("click", async () => {
      const transcript = state.judge.transcriptText || "";
      if (!transcript.trim()) {
        if (els.draftStatus) {
          els.draftStatus.textContent = "Add a transcript before drafting captions.";
        }
        return;
      }
      if (!state.judge.formType) {
        if (els.draftStatus) {
          els.draftStatus.textContent = "Select a form type before drafting.";
        }
        return;
      }
      if (!els.captionForm?.children?.length) {
        renderCaptionForm();
      }
      els.draftBtn.dataset.loadingLabel = "Drafting...";
      els.draftBtn.dataset.spinner = "true";
      await withLoading(els.draftBtn, async () => {
        if (els.draftStatus) {
          els.draftStatus.textContent = "Drafting captions. Please wait...";
        }
        const overwrite = Boolean(els.overwriteCaptionsToggle?.checked);
        const result = await draftCaptionsFromTranscript({
          transcript,
          formType: state.judge.formType,
        });
        if (!result?.ok) {
          if (els.draftStatus) {
            els.draftStatus.textContent =
              result?.message || "Unable to draft captions.";
          }
          return;
        }
        applyCaptionDraft({ captions: result.captions, overwrite, isTest: false });
        if (els.draftStatus) {
          els.draftStatus.textContent = "Drafted captions.";
        }
      });
    });
  }

  if (els.transcribeBtn) {
    els.transcribeBtn.addEventListener("click", async () => {
      if (els.transcribeBtn.disabled) return;
      els.transcribeBtn.dataset.loadingLabel = "Transcribing...";
      els.transcribeBtn.dataset.spinner = "true";
      await withLoading(els.transcribeBtn, async () => {
        setSubmissionHint("Transcription in progress. Please wait...");
        const result = await transcribeSubmissionAudio();
        if (!result?.ok) {
          setSubmissionHint(result?.message || "Transcription failed.");
          return;
        }
        if (els.transcriptInput) {
          els.transcriptInput.value = result.transcript || "";
        }
        state.judge.transcriptText = result.transcript || "";
        setSubmissionHint("Transcription complete.");
      });
      updateTranscribeState();
    });
  }

  if (els.testTranscribeBtn) {
    els.testTranscribeBtn.addEventListener("click", async () => {
      if (els.testTranscribeBtn.disabled) return;
      els.testTranscribeBtn.dataset.loadingLabel = "Transcribing...";
      els.testTranscribeBtn.dataset.spinner = "true";
      await withLoading(els.testTranscribeBtn, async () => {
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Transcription in progress. Please wait...";
        }
        const result = await transcribeTestAudio();
        if (!result?.ok) {
          if (els.testRecordingStatus) {
            els.testRecordingStatus.textContent = result?.message || "Transcription failed.";
          }
          return;
        }
        if (els.testTranscriptInput) {
          els.testTranscriptInput.value = result.transcript || "";
        }
        state.judge.testTranscriptText = result.transcript || "";
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Transcription complete.";
        }
      });
      updateTestTranscribeState();
    });
  }

  if (els.recordBtn) {
    els.recordBtn.addEventListener("click", () => {
      startAudioCapture({ isTest: false });
    });
  }

  if (els.stopBtn) {
    els.stopBtn.addEventListener("click", () => {
      stopAudioCapture({ isTest: false });
    });
  }

  if (els.testRecordBtn) {
    els.testRecordBtn.addEventListener("click", () => {
      startAudioCapture({ isTest: true });
    });
  }

  if (els.testStopBtn) {
    els.testStopBtn.addEventListener("click", () => {
      stopAudioCapture({ isTest: true });
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
      setOpenPacketHint("Submitted and locked.");
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
    updateOpenSubmitState();
    return;
  }
  els.judgeOpenRecordingStatus.classList.remove("recording-active");
  if (els.judgeOpenRecordDot) {
    els.judgeOpenRecordDot.classList.remove("is-active");
  }
  if (els.judgeOpenRecordLabel) {
    els.judgeOpenRecordLabel.textContent = "Record Append";
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
      if (els.directorEnsembleForm) {
        els.directorEnsembleForm.classList.remove("is-hidden");
      }
      if (els.directorEnsembleError) {
        els.directorEnsembleError.textContent = "";
      }
      if (els.directorEnsembleNameInput) {
        els.directorEnsembleNameInput.focus();
      }
    });
  }

  if (els.directorEnsembleCancelBtn) {
    els.directorEnsembleCancelBtn.addEventListener("click", () => {
      if (els.directorEnsembleForm) {
        els.directorEnsembleForm.classList.add("is-hidden");
      }
      if (els.directorEnsembleError) {
        els.directorEnsembleError.textContent = "";
      }
      if (els.directorEnsembleForm) {
        els.directorEnsembleForm.reset();
      }
    });
  }

  if (els.directorAttachBtn) {
    els.directorAttachBtn.addEventListener("click", async () => {
      const schoolId = els.directorAttachSelect?.value || "";
      if (!schoolId) return;
      const result = await attachDirectorSchool(schoolId);
      if (result?.ok) {
        updateDirectorAttachUI();
        startWatchers();
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
        startWatchers();
      }
    });
  }

  if (els.directorEnsembleForm) {
    els.directorEnsembleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = els.directorEnsembleNameInput?.value.trim() || "";
      if (!name) {
        if (els.directorEnsembleError) {
          els.directorEnsembleError.textContent = "Ensemble name is required.";
        }
        return;
      }
      if (els.directorEnsembleError) {
        els.directorEnsembleError.textContent = "";
      }
      const result = await createDirectorEnsemble(name);
      if (result?.ok) {
        els.directorEnsembleForm.reset();
        els.directorEnsembleForm.classList.add("is-hidden");
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
      const result = await markEntryReady();
      if (!result) return;
      if (!result.ok) {
        if (result.message) {
          alertUser(result.message);
        }
        return;
      }
      setDirectorEntryStatusLabel("Ready");
      setDirectorReadyControls({ status: "ready" });
      renderDirectorChecklist(
        state.director.entryDraft,
        computeDirectorCompletionState(state.director.entryDraft)
      );
    });
  }
  if (els.directorEntryUndoReadyBtn) {
    els.directorEntryUndoReadyBtn.addEventListener("click", async () => {
      const result = await markEntryDraft();
      if (!result) return;
      if (!result.ok) {
        if (result.message) {
          alertUser(result.message);
        }
        return;
      }
      setDirectorEntryStatusLabel("Draft");
      updateDirectorReadyControlsFromState(
        computeDirectorCompletionState(state.director.entryDraft)
      );
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
      window.location.hash = "#director";
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
            scrollToSection(els.adminReadinessPanel);
            break;
          case "admin-events":
            setTab("admin", { force: true });
            scrollToSection(els.adminEventsSection || els.adminScheduleSection);
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
