import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  limit,
  onSnapshot,
  getDocs,
  orderBy,
  addDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  Timestamp,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
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
  GRADE_VALUES,
  els,
  state,
} from "./state.js";
import { auth, db, storage, functions, DEV_FLAGS, firebaseConfig } from "./firebase.js";

function setRoleHint(message) {
  els.roleHint.textContent = message;
}

function isDirectorManager() {
  return state.auth.userProfile?.role === "director" || state.auth.userProfile?.role === "admin";
}

function setAuthSuccess(message) {
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

function setProvisioningNotice(message) {
  if (!els.provisioningNotice) return;
  if (!message) {
    els.provisioningNotice.hidden = true;
    els.provisioningNotice.textContent = "";
    return;
  }
  els.provisioningNotice.hidden = false;
  els.provisioningNotice.textContent = message;
}

function setDirectorSaveStatus(message) {
  if (!els.directorSaveStatus) return;
  els.directorSaveStatus.textContent = message || "";
}

function setPerformanceGradeError(message) {
  if (!els.performanceGradeError) return;
  els.performanceGradeError.textContent = message || "";
}

function setSavingState(button, isSaving, savingLabel = "Saving...") {
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

function ensureButtonSpinner(button) {
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

async function withLoading(buttonElement, asyncFn) {
  if (!buttonElement) {
    return asyncFn();
  }
  if (buttonElement.dataset.loading === "true") return;
  buttonElement.dataset.loading = "true";
  const originalLabel = buttonElement.textContent;
  const loadingLabel = buttonElement.dataset.loadingLabel || "Saving...";
  buttonElement.dataset.originalLabel = originalLabel;
  buttonElement.disabled = true;
  buttonElement.textContent = loadingLabel;
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
    buttonElement.textContent = originalLabel;
    buttonElement.classList.remove("is-loading");
    delete buttonElement.dataset.loading;
    delete buttonElement.dataset.originalLabel;
  }
}

function showStatusMessage(targetEl, message, type = "info") {
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

function setDirectorEntryStatusLabel(status) {
  if (els.directorEntryStatus) {
    els.directorEntryStatus.textContent = status || "Draft";
  }
  if (els.directorEntryStatusBadge) {
    els.directorEntryStatusBadge.textContent = status || "Draft";
  }
}

function setDirectorProfileStatus(message) {
  if (!els.directorProfileCardStatus) return;
  els.directorProfileCardStatus.textContent = message || "";
}

function markDirectorDirty(section) {
  if (!section) return;
  state.director.dirtySections.add(section);
  state.director.draftVersion += 1;
  renderDirectorChecklist(state.director.entryDraft);
}

function clearDirectorDirty(section) {
  if (!section) return;
  state.director.dirtySections.delete(section);
}

function hasDirectorUnsavedChanges() {
  return state.director.dirtySections.size > 0;
}

function markJudgeDirty() {
  state.judge.draftDirty = true;
  state.judge.draftVersion += 1;
}

function hasJudgeUnsavedChanges() {
  return state.judge.draftDirty;
}

function hasUnsavedChanges() {
  return hasDirectorUnsavedChanges() || hasJudgeUnsavedChanges();
}

function showDirectorAutosaveIndicator() {
  if (!els.directorAutosaveIndicator) return;
  els.directorAutosaveIndicator.classList.add("is-visible");
  if (state.director.autosaveIndicatorTimeout) {
    window.clearTimeout(state.director.autosaveIndicatorTimeout);
  }
  state.director.autosaveIndicatorTimeout = window.setTimeout(() => {
    els.directorAutosaveIndicator.classList.remove("is-visible");
  }, 3000);
}

function resetJudgeDraftState(submissionKey = null) {
  state.judge.draftDirty = false;
  state.judge.draftVersion = 0;
  state.judge.draftSubmissionKey = submissionKey;
}

function getJudgeDraftSubmissionKey() {
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position) return null;
  return `${state.event.active.id}_${state.judge.selectedRosterEntry.ensembleId}_${state.judge.position}`;
}

function buildDirectorAutosavePayload() {
  const repertoire = buildRepertoirePayload();
  const instrumentation = state.director.entryDraft?.instrumentation || {};
  const rule3c = state.director.entryDraft?.rule3c || {};
  const seating = state.director.entryDraft?.seating || {};
  const percussionNeeds = state.director.entryDraft?.percussionNeeds || {};
  const lunchOrder = state.director.entryDraft?.lunchOrder || {};

  const normalizedInstrumentation = {
    totalPercussion: normalizeNumber(instrumentation.totalPercussion),
    standardCounts: instrumentation.standardCounts || {},
    nonStandard: Array.isArray(instrumentation.nonStandard)
      ? instrumentation.nonStandard.map((row) => ({
          instrumentName: row?.instrumentName || "",
          count: normalizeNumber(row?.count),
        }))
      : [],
    otherInstrumentationNotes: instrumentation.otherInstrumentationNotes || "",
  };
  Object.keys(normalizedInstrumentation.standardCounts).forEach((key) => {
    normalizedInstrumentation.standardCounts[key] = normalizeNumber(
      normalizedInstrumentation.standardCounts[key]
    );
  });

  const normalizedRule3c = {
    ...rule3c,
    entries: ensureArrayLength(
      rule3c.entries,
      MAX_RULE3C_ENTRIES,
      () => ({
        studentNameOrIdentifier: "",
        instrument: "",
        alsoDoublesInEnsembleId: "",
      })
    ).map((row) => ({
      studentNameOrIdentifier: row?.studentNameOrIdentifier || "",
      instrument: row?.instrument || "",
      alsoDoublesInEnsembleId: row?.alsoDoublesInEnsembleId || "",
    })),
  };

  const normalizedSeating = {
    ...seating,
    rows: ensureArrayLength(
      seating.rows,
      SEATING_ROWS,
      () => ({ chairs: 0, stands: 0 })
    ).map((row) => ({
      chairs: normalizeNumber(row?.chairs),
      stands: normalizeNumber(row?.stands),
    })),
  };

  const normalizedPercussion = {
    ...percussionNeeds,
    selected: Array.isArray(percussionNeeds.selected)
      ? percussionNeeds.selected.filter(Boolean)
      : [],
    notes: percussionNeeds.notes || "",
  };

  const normalizedLunch = {
    ...lunchOrder,
    pepperoniQty: normalizeNumber(lunchOrder.pepperoniQty),
    cheeseQty: normalizeNumber(lunchOrder.cheeseQty),
    notes: lunchOrder.notes || "",
  };

  return {
    status: "draft",
    performanceGrade: state.director.entryDraft?.performanceGrade || "",
    repertoire,
    instrumentation: normalizedInstrumentation,
    rule3c: normalizedRule3c,
    seating: normalizedSeating,
    percussionNeeds: normalizedPercussion,
    lunchOrder: normalizedLunch,
  };
}

async function autosaveDirectorEntry() {
  if (!state.auth.currentUser || !state.auth.userProfile) return;
  if (!state.director.entryRef || !state.director.entryDraft) return;
  if (!hasDirectorUnsavedChanges()) return;
  if (state.director.entrySaveInFlight || state.director.autosaveInFlight) return;
  if (state.director.entryDraft.status === "ready") return;
  state.director.autosaveInFlight = true;
  const startVersion = state.director.draftVersion;
  try {
    await ensureEntryDocExists();
    const payload = buildDirectorAutosavePayload();
    await updateDoc(state.director.entryRef, {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    state.director.entryDraft.status = "draft";
    setDirectorEntryStatusLabel("Draft");
    if (state.director.draftVersion === startVersion) {
      state.director.dirtySections.clear();
      showDirectorAutosaveIndicator();
    }
  } catch (error) {
    console.error("Director autosave failed", error);
  } finally {
    state.director.autosaveInFlight = false;
  }
}

async function autosaveJudgeDraft() {
  if (!state.judge.draftDirty) return;
  if (state.judge.autosaveInFlight) return;
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "judge") return;
  if (state.judge.isTestMode) return;
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position || !state.judge.formType) return;
  const submissionKey = getJudgeDraftSubmissionKey();
  if (!submissionKey) return;
  if (state.judge.draftSubmissionKey && state.judge.draftSubmissionKey !== submissionKey) return;
  state.judge.autosaveInFlight = true;
  const startVersion = state.judge.draftVersion;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionKey);
  try {
    const submissionSnap = await getDoc(submissionRef);
    const currentStatus = submissionSnap.exists() ? submissionSnap.data()?.status : null;
    if (currentStatus === STATUSES.submitted || currentStatus === STATUSES.released) {
      return;
    }
    const captionScoreTotal = calculateCaptionTotal(state.judge.captions);
    const rating = computeFinalRating(captionScoreTotal);
    const payload = {
      [FIELDS.submissions.status]: "draft",
      [FIELDS.submissions.locked]: false,
      [FIELDS.submissions.judgeUid]: state.auth.currentUser.uid,
      [FIELDS.submissions.judgeName]:
        state.auth.userProfile?.displayName || state.auth.currentUser.displayName || "",
      [FIELDS.submissions.judgeEmail]:
        state.auth.userProfile?.email || state.auth.currentUser.email || "",
      [FIELDS.submissions.judgeTitle]: state.auth.userProfile?.title || "",
      [FIELDS.submissions.judgeAffiliation]: state.auth.userProfile?.affiliation || "",
      [FIELDS.submissions.schoolId]: state.judge.selectedRosterEntry.schoolId,
      [FIELDS.submissions.eventId]: state.event.active.id,
      [FIELDS.submissions.ensembleId]: state.judge.selectedRosterEntry.ensembleId,
      [FIELDS.submissions.judgePosition]: state.judge.position,
      [FIELDS.submissions.formType]: state.judge.formType,
      [FIELDS.submissions.transcript]: els.transcriptInput.value.trim(),
      [FIELDS.submissions.captions]: state.judge.captions,
      [FIELDS.submissions.captionScoreTotal]: captionScoreTotal,
      [FIELDS.submissions.computedFinalRatingJudge]: rating.value,
      [FIELDS.submissions.computedFinalRatingLabel]: rating.label,
      [FIELDS.submissions.updatedAt]: serverTimestamp(),
    };
    if (!submissionSnap.exists()) {
      payload[FIELDS.submissions.createdAt] = serverTimestamp();
      await setDoc(submissionRef, payload);
    } else {
      await setDoc(submissionRef, payload, { merge: true });
    }
    if (state.judge.draftVersion === startVersion) {
      state.judge.draftDirty = false;
      state.judge.draftSubmissionKey = submissionKey;
    }
  } catch (error) {
    console.error("Judge autosave failed", error);
  } finally {
    state.judge.autosaveInFlight = false;
  }
}

function startAutosaveLoop() {
  if (state.app.autosaveIntervalId) return;
  state.app.autosaveIntervalId = window.setInterval(() => {
    autosaveDirectorEntry();
    autosaveJudgeDraft();
  }, 15000);
}

function confirmDiscardUnsaved() {
  if (!hasUnsavedChanges()) return true;
  return window.confirm("You have unsaved changes. Leave anyway?");
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function romanToLevel(roman) {
  const map = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return map[roman] || null;
}

function levelToRoman(level) {
  const map = ["I", "II", "III", "IV", "V", "VI"];
  return map[level - 1] || "";
}

function derivePerformanceGrade(gradeA, gradeB) {
  const a = Number(gradeA || 0);
  const b = Number(gradeB || 0);
  if (!a || !b) return { ok: false, error: "Select grades for both selections." };
  if (a === b) {
    const roman = levelToRoman(a);
    return { ok: true, value: roman };
  }
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (max - min !== 1) {
    return {
      ok: false,
      error: "Grades must match or be adjacent (I/II, II/III, III/IV, IV/V, V/VI).",
    };
  }
  return { ok: true, value: `${levelToRoman(min)}/${levelToRoman(max)}` };
}

function renderDirectorProfile() {
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

function renderSchoolOptions(selectEl, placeholder) {
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

function refreshSchoolDropdowns() {
  renderSchoolOptions(els.directorSchoolSelect, "Select a school");
  renderSchoolOptions(els.directorAttachSelect, "Select a school");
  renderSchoolOptions(els.provisionSchoolSelect, "Select a school (optional)");
  renderSchoolOptions(els.scheduleSchoolSelect, "Select a school");
}

function getSchoolNameById(schoolId) {
  const match = state.admin.schoolsList.find((school) => school.id === schoolId);
  return match?.name || schoolId || "Unknown";
}

function ensureArrayLength(arr, length, factory) {
  const next = Array.isArray(arr) ? [...arr] : [];
  while (next.length < length) {
    next.push(factory());
  }
  return next.slice(0, length);
}

function buildDefaultEntry({ eventId, schoolId, ensembleId, createdByUid }) {
  const standardCounts = STANDARD_INSTRUMENTS.reduce((acc, item) => {
    acc[item.key] = 0;
    return acc;
  }, {});
  return {
    eventId,
    schoolId,
    ensembleId,
    createdByUid,
    status: "draft",
    performanceGrade: "",
    repertoire: {
      march: {
        titleText: "",
        composerArrangerText: "",
        workId: null,
        catalogSource: null,
      },
      selection1: {
        gradeLevel: null,
        titleText: "",
        composerArrangerText: "",
        workId: null,
        catalogSource: null,
      },
      selection2: {
        gradeLevel: null,
        titleText: "",
        composerArrangerText: "",
        workId: null,
        catalogSource: null,
      },
    },
    instrumentation: {
      standardCounts,
      totalPercussion: 0,
      nonStandard: [],
      otherInstrumentationNotes: "",
    },
    rule3c: {
      entries: Array.from({ length: MAX_RULE3C_ENTRIES }, () => ({
        studentNameOrIdentifier: "",
        instrument: "",
        alsoDoublesInEnsembleId: "",
      })),
      notes: "",
    },
    seating: {
      rows: Array.from({ length: SEATING_ROWS }, () => ({
        chairs: 0,
        stands: 0,
      })),
      notes: "",
    },
    percussionNeeds: {
      selected: [],
      notes: "",
    },
    lunchOrder: {
      pepperoniQty: 0,
      cheeseQty: 0,
      notes: "",
    },
  };
}

function normalizeEntryData(data, defaults) {
  const base = { ...defaults, ...(data || {}) };
  base.repertoire = { ...defaults.repertoire, ...(data?.repertoire || {}) };
  REPERTOIRE_FIELDS.forEach((item) => {
    base.repertoire[item.key] = {
      ...(defaults.repertoire[item.key] || {}),
      ...(data?.repertoire?.[item.key] || {}),
    };
  });
  ["selection1", "selection2"].forEach((key) => {
    const gradeLevel =
      data?.repertoire?.[key]?.gradeLevel ??
      defaults.repertoire[key]?.gradeLevel ??
      null;
    base.repertoire[key].gradeLevel = gradeLevel;
  });
  base.instrumentation = {
    ...defaults.instrumentation,
    ...(data?.instrumentation || {}),
  };
  base.instrumentation.standardCounts = {
    ...defaults.instrumentation.standardCounts,
    ...(data?.instrumentation?.standardCounts || {}),
  };
  base.instrumentation.nonStandard = Array.isArray(
    data?.instrumentation?.nonStandard
  )
    ? data.instrumentation.nonStandard.map((row) => ({
        instrumentName: row?.instrumentName || "",
        count: Number(row?.count || 0),
      }))
    : [];
  base.rule3c = {
    ...defaults.rule3c,
    ...(data?.rule3c || {}),
  };
  base.rule3c.entries = ensureArrayLength(
    data?.rule3c?.entries,
    MAX_RULE3C_ENTRIES,
    () => ({
      studentNameOrIdentifier: "",
      instrument: "",
      alsoDoublesInEnsembleId: "",
    })
  ).map((row) => ({
    studentNameOrIdentifier: row?.studentNameOrIdentifier || "",
    instrument: row?.instrument || "",
    alsoDoublesInEnsembleId: row?.alsoDoublesInEnsembleId || "",
  }));
  base.seating = {
    ...defaults.seating,
    ...(data?.seating || {}),
  };
  base.seating.rows = ensureArrayLength(
    data?.seating?.rows,
    SEATING_ROWS,
    () => ({ chairs: 0, stands: 0 })
  ).map((row) => ({
    chairs: Number(row?.chairs || 0),
    stands: Number(row?.stands || 0),
  }));
  base.percussionNeeds = {
    ...defaults.percussionNeeds,
    ...(data?.percussionNeeds || {}),
  };
  base.percussionNeeds.selected = Array.isArray(
    data?.percussionNeeds?.selected
  )
    ? data.percussionNeeds.selected.filter(Boolean)
    : [];
  base.lunchOrder = {
    ...defaults.lunchOrder,
    ...(data?.lunchOrder || {}),
  };
  return base;
}

function setValueAtPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const key = Number.isNaN(Number(part)) ? part : Number(part);
    if (isLast) {
      current[key] = value;
      return;
    }
    if (current[key] == null) {
      const nextKey = parts[index + 1];
      const nextIsNumber = !Number.isNaN(Number(nextKey));
      current[key] = nextIsNumber ? [] : {};
    }
    current = current[key];
  });
}

function getValueAtPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    const key = Number.isNaN(Number(part)) ? part : Number(part);
    current = current[key];
  }
  return current;
}

function updateScheduleSubmitState() {
  if (!els.scheduleSubmitBtn) return;
  const hasEvent = Boolean(state.event.active);
  const performanceAt = els.performanceAtInput?.value.trim();
  const schoolId = els.scheduleSchoolSelect?.value;
  const ensembleId = els.scheduleEnsembleSelect?.value;
  const ready = hasEvent && performanceAt && schoolId && ensembleId;
  els.scheduleSubmitBtn.disabled = !ready;
}

function updateScheduleEnsembles() {
  if (!els.scheduleEnsembleSelect) return;
  if (state.subscriptions.scheduleEnsembles) {
    state.subscriptions.scheduleEnsembles();
    state.subscriptions.scheduleEnsembles = null;
  }
  const schoolId = els.scheduleSchoolSelect?.value;
  els.scheduleEnsembleSelect.innerHTML = "";
  els.scheduleEnsembleSelect.disabled = !schoolId;
  const baseOption = document.createElement("option");
  baseOption.value = "";
  baseOption.textContent = "Select an ensemble";
  els.scheduleEnsembleSelect.appendChild(baseOption);
  if (!schoolId) {
    if (els.scheduleEnsembleHint) {
      els.scheduleEnsembleHint.textContent = "";
    }
    updateScheduleSubmitState();
    return;
  }
  const ensemblesRef = collection(
    db,
    COLLECTIONS.schools,
    schoolId,
    "ensembles"
  );
  const ensemblesQuery = query(ensemblesRef, orderBy("name"));
  state.subscriptions.scheduleEnsembles = onSnapshot(ensemblesQuery, (snapshot) => {
    els.scheduleEnsembleSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an ensemble";
    els.scheduleEnsembleSelect.appendChild(placeholder);
    if (snapshot.empty) {
      if (els.scheduleEnsembleHint) {
        els.scheduleEnsembleHint.textContent =
          "No ensembles created yet for this school.";
      }
      els.scheduleEnsembleSelect.disabled = true;
      updateScheduleSubmitState();
      return;
    }
    if (els.scheduleEnsembleHint) {
      els.scheduleEnsembleHint.textContent = "";
    }
    els.scheduleEnsembleSelect.disabled = false;
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = data.name || docSnap.id;
      els.scheduleEnsembleSelect.appendChild(option);
    });
    updateScheduleSubmitState();
  });
}

function openAuthModal() {
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

function closeAuthModal() {
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

function showSessionExpiredModal() {
  if (!els.sessionExpiredModal) return;
  els.sessionExpiredModal.classList.add("is-open");
  els.sessionExpiredModal.setAttribute("aria-hidden", "false");
}

function hideSessionExpiredModal() {
  if (!els.sessionExpiredModal) return;
  els.sessionExpiredModal.classList.remove("is-open");
  els.sessionExpiredModal.setAttribute("aria-hidden", "true");
}

function setMainInteractionDisabled(disabled) {
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

function updateConnectivityUI() {
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

function setAuthView(view) {
  if (!els.authSignInView || !els.authDirectorView || !els.authAccountView) return;
  const isSignIn = view === "signIn";
  const isDirector = view === "director";
  const isAccount = view === "account";
  els.authSignInView.classList.toggle("is-hidden", !isSignIn);
  els.authDirectorView.classList.toggle("is-hidden", !isDirector);
  els.authAccountView.classList.toggle("is-hidden", !isAccount);
}

function openDirectorProfileModal() {
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

function closeDirectorProfileModal() {
  if (!els.directorProfileModal) return;
  els.directorProfileModal.classList.remove("is-open");
  els.directorProfileModal.setAttribute("aria-hidden", "true");
}

function updateAuthUI() {
  if (state.auth.currentUser) {
    const label = state.auth.currentUser.email ? state.auth.currentUser.email : "Signed in";
    els.signOutBtn.disabled = false;
    if (els.accountSummary) {
      els.accountSummary.textContent = `Signed in as ${label}`;
    }
    if (els.currentUidDisplay) {
      els.currentUidDisplay.textContent = "Hidden";
    }
    if (els.copyUidBtn) {
      els.copyUidBtn.disabled = true;
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
    if (els.currentUidDisplay) {
      els.currentUidDisplay.textContent = "Signed out";
    }
    if (els.copyUidBtn) {
      els.copyUidBtn.disabled = true;
    }
    if (els.modalAuthActions && els.signOutBtn.parentElement !== els.modalAuthActions) {
      els.modalAuthActions.appendChild(els.signOutBtn);
    }
    if (els.signInBtn) {
      els.signInBtn.style.display = "inline-flex";
    }
  }
}

function getDefaultTabForRole(role) {
  if (role === "admin") return "admin";
  if (role === "judge") return "judge";
  if (role === "director") return "director";
  return null;
}

function isTabAllowed(tab, role) {
  if (!role) return false;
  if (role === "admin") return true;
  return tab === role;
}

function setTab(tabName, { force } = {}) {
  const role = state.auth.userProfile?.role || null;
  if (!force && role && !isTabAllowed(tabName, role)) return;
  if (state.app.currentTab === "director" && tabName !== "director") {
    if (!confirmDiscardUnsaved()) return;
  }
  state.app.currentTab = tabName;
  els.tabButtons.forEach((button) => {
    const isSelected = button.dataset.tab === tabName;
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
    button.disabled = !isTabAllowed(button.dataset.tab, role);
    button.tabIndex = isSelected ? 0 : -1;
  });
  const showAdmin = tabName === "admin";
  const showJudge = tabName === "judge";
  const showDirector = tabName === "director";
  els.adminCard.hidden = !showAdmin;
  els.judgeCard.hidden = !showJudge;
  els.directorCard.hidden = !showDirector;
  els.adminCard.style.display = showAdmin ? "grid" : "none";
  els.judgeCard.style.display = showJudge ? "grid" : "none";
  els.directorCard.style.display = showDirector ? "grid" : "none";
  if (els.eventDetailPage && !els.eventDetailPage.classList.contains("is-hidden")) {
    hideEventDetail();
  }
}

function showEventDetail(eventId) {
  if (!els.eventDetailPage) return;
  const event = state.event.list.find((item) => item.id === eventId);
  if (els.eventDetailTitle) {
    els.eventDetailTitle.textContent = event?.name || "Event Details";
  }
  if (els.eventDetailMeta) {
    els.eventDetailMeta.textContent = event
      ? getEventLabel(event)
      : "Event not found.";
  }
  els.eventDetailPage.classList.remove("is-hidden");
  els.adminCard.style.display = "none";
  els.judgeCard.style.display = "none";
  els.directorCard.style.display = "none";
}

function hideEventDetail() {
  if (!els.eventDetailPage) return;
  els.eventDetailPage.classList.add("is-hidden");
  if (state.app.currentTab) {
    const tab = state.app.currentTab;
    state.app.currentTab = null;
    setTab(tab, { force: true });
  }
}

function handleHashChange() {
  const hash = window.location.hash || "";
  if (hash.startsWith("#event/")) {
    const eventId = hash.replace("#event/", "").trim();
    if (eventId) {
      showEventDetail(eventId);
      return;
    }
  }
  if (hash === "#director") {
    if (!state.auth.currentUser) {
      openAuthModal();
      setAuthView("director");
      return;
    }
    setTab("director", { force: true });
  } else if (hash === "#judge") {
    setTab("judge", { force: true });
  } else if (hash === "#admin") {
    setTab("admin", { force: true });
  }
  hideEventDetail();
}

function updateRoleUI() {
  if (!state.auth.currentUser) {
    document.body.classList.add("auth-locked");
    document.body.classList.remove("director-only");
    els.adminCard.style.display = "none";
    els.judgeCard.style.display = "none";
    els.directorCard.style.display = "none";
    els.tabButtons.forEach((button) => {
      button.setAttribute("aria-selected", "false");
      button.disabled = true;
    });
    setRoleHint("Sign in with your provisioned account.");
    setProvisioningNotice("");
    if (els.directorSchoolName) {
      els.directorSchoolName.textContent = "No school attached";
    }
    if (els.directorSummarySchool) {
      els.directorSummarySchool.textContent = "No school attached";
    }
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
    els.adminCard.style.display = "none";
    els.judgeCard.style.display = "none";
    els.directorCard.style.display = "none";
    els.tabButtons.forEach((button) => {
      button.setAttribute("aria-selected", "false");
      button.disabled = true;
    });
    setRoleHint("Account not provisioned. Contact the chair/admin to be added.");
    setProvisioningNotice(
      "Account not provisioned. Contact the chair/admin to be added before you can access the consoles."
    );
    if (els.directorSchoolName) {
      els.directorSchoolName.textContent = "No school attached";
    }
    if (els.directorSummarySchool) {
      els.directorSummarySchool.textContent = "No school attached";
    }
    return;
  }

  document.body.classList.remove("auth-locked");
  if (state.auth.userProfile.role === "director") {
    document.body.classList.add("director-only");
  } else {
    document.body.classList.remove("director-only");
  }
  setRoleHint(`Role: ${state.auth.userProfile.role || "unknown"}`);
  setProvisioningNotice("");
  const defaultTab = getDefaultTabForRole(state.auth.userProfile.role);
  setTab(defaultTab, { force: true });
  if (state.auth.userProfile.role === "director") {
    const name =
      state.auth.userProfile.displayName ||
      state.auth.currentUser?.displayName ||
      "Director";
    const email = state.auth.userProfile.email || state.auth.currentUser?.email || "";
    if (els.directorSummaryName) {
      els.directorSummaryName.textContent = name;
    }
    if (els.directorSummaryEmail) {
      els.directorSummaryEmail.textContent = email;
    }
  }
  updateDirectorAttachUI();
}

function updateDirectorAttachUI() {
  if (!els.directorAttachGate) return;
  const isDirector = isDirectorManager();
  const hasSchool = Boolean(state.auth.userProfile?.schoolId);
  els.directorAttachGate.style.display =
    isDirector && !hasSchool ? "block" : "none";
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

function resetJudgeState() {
  state.judge.position = null;
  state.judge.formType = null;
  state.judge.selectedRosterEntry = null;
  state.judge.audioBlob = null;
  state.judge.audioDurationSec = 0;
  state.judge.currentSubmissionHasAudio = false;
  state.judge.captions = {};
  els.playback.src = "";
  els.transcriptInput.value = "";
  els.captionForm.innerHTML = "";
  els.captionTotal.textContent = "0";
  els.finalRating.textContent = "N/A";
  els.submissionHint.textContent = "Select an ensemble to begin.";
  if (els.judgeEntrySummary) {
    els.judgeEntrySummary.textContent = "";
  }
  lockSubmissionUI(null);
  resetJudgeDraftState(null);
  updateTranscribeState();
  renderJudgeReadiness();
}

function updateAdminEmptyState() {
  if (!els.adminEmpty) return;
  els.adminEmpty.style.display = state.event.active ? "none" : "block";
  if (els.adminStatusBadge) {
    els.adminStatusBadge.textContent = state.event.active
      ? "Active event"
      : "No active event";
  }
  renderAdminReadiness();
}

function updateJudgeEmptyState() {
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

function updateTranscribeState() {
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
  console.log("transcribeGate", {
    hasUser: Boolean(state.auth.currentUser),
    hasEvent: Boolean(state.event.active),
    hasRoster: Boolean(state.judge.selectedRosterEntry),
    hasPosition: Boolean(state.judge.position),
    hasSubmissionAudio: state.judge.currentSubmissionHasAudio,
    hasLocalAudio,
    ready,
  });
  els.transcribeBtn.disabled = !ready;
  els.transcribeBtn.title = ready
    ? ""
    : "Record audio and select an ensemble to enable transcription.";
  renderJudgeReadiness();
}

function updateTestTranscribeState() {
  if (!els.testTranscribeBtn) return;
  els.testTranscribeBtn.disabled = !state.judge.testAudioBlob;
  renderJudgeTestReadiness();
}

function lockSubmissionUI(submissionData) {
  const isSubmitted = submissionData?.status === STATUSES.submitted;
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
      el.disabled = isSubmitted;
    });
  }
  if (els.recordBtn) {
    els.recordBtn.style.display = isSubmitted ? "none" : "";
    if (!isSubmitted) els.recordBtn.disabled = false;
  }
  if (els.stopBtn) {
    els.stopBtn.style.display = isSubmitted ? "none" : "";
    if (!isSubmitted) els.stopBtn.disabled = true;
  }
  if (els.submitBtn) {
    els.submitBtn.style.display = isSubmitted ? "none" : "";
    if (isSubmitted) {
      els.submitBtn.dataset.locked = "true";
    } else {
      els.submitBtn.dataset.locked = "false";
    }
    if (!isSubmitted && !state.app.isOffline) {
      els.submitBtn.disabled = false;
    }
  }
  if (!isSubmitted) {
    updateTranscribeState();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result || "";
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getEventLabel(event) {
  if (!event) return "Unknown event";
  const startLabel = event.startAt ? formatPerformanceAt(event.startAt) : "";
  const endLabel = event.endAt ? formatPerformanceAt(event.endAt) : "";
  const dateLabel =
    startLabel && endLabel ? ` • ${startLabel} → ${endLabel}` : "";
  return `${event.name || "Event"} (${event.id})${dateLabel}`;
}

function getEventCardLabel(event) {
  if (!event) return "Unknown event";
  const startDate = event.startAt ? formatDateHeading(event.startAt) : "";
  const endDate = event.endAt ? formatDateHeading(event.endAt) : "";
  const dateLabel =
    startDate && endDate && startDate !== endDate
      ? ` • ${startDate} – ${endDate}`
      : startDate || endDate || "";
  return `${event.name || "Event"}${dateLabel ? ` • ${dateLabel}` : ""}`;
}

async function getDirectorNameForSchool(schoolId) {
  if (!schoolId) return "Unknown";
  if (state.director.nameCache.has(schoolId)) {
    return state.director.nameCache.get(schoolId);
  }
  if (state.auth.userProfile?.role === "director" && state.auth.userProfile.schoolId === schoolId) {
    const name =
      state.auth.userProfile.displayName || state.auth.userProfile.email || state.auth.currentUser?.email || "Unknown";
    state.director.nameCache.set(schoolId, name);
    return name;
  }
  try {
    const directorQuery = query(
      collection(db, COLLECTIONS.users),
      where(FIELDS.users.role, "==", "director"),
      where(FIELDS.users.schoolId, "==", schoolId),
      limit(1)
    );
    const directorSnap = await getDocs(directorQuery);
    if (!directorSnap.empty) {
      const data = directorSnap.docs[0].data();
      const name = data.displayName || data.email || "Unknown";
      state.director.nameCache.set(schoolId, name);
      return name;
    }
  } catch (error) {
    console.error("Failed to fetch director name", error);
  }
  const fallback = "Unknown";
  state.director.nameCache.set(schoolId, fallback);
  return fallback;
}

function renderDirectorEventOptions() {
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
  if (els.directorSetEventBtn) {
    els.directorSetEventBtn.disabled = !els.directorEventSelect.value;
  }
  updateDirectorEventMeta();
  loadDirectorEntry();
}

function updateDirectorEventMeta() {
  if (!els.directorEventMeta) return;
  const event = state.event.list.find((item) => item.id === state.director.selectedEventId);
  if (!event) {
    els.directorEventMeta.textContent = "No event selected.";
    if (els.directorScheduleBtn) {
      els.directorScheduleBtn.disabled = true;
    }
    return;
  }
  els.directorEventMeta.textContent = getEventCardLabel(event);
  if (els.directorScheduleBtn) {
    els.directorScheduleBtn.disabled = false;
  }
}

function calculateCaptionTotal(captions) {
  return Object.values(captions).reduce((sum, caption) => {
    const score = GRADE_VALUES[caption.gradeLetter] ?? 0;
    return sum + score;
  }, 0);
}

function computeFinalRating(total) {
  if (total >= 7 && total <= 10) return { label: "I", value: 1 };
  if (total >= 11 && total <= 17) return { label: "II", value: 2 };
  if (total >= 18 && total <= 24) return { label: "III", value: 3 };
  if (total >= 25 && total <= 31) return { label: "IV", value: 4 };
  if (total >= 32 && total <= 35) return { label: "V", value: 5 };
  return { label: "N/A", value: null };
}

function normalizeGrade(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  if (roman.includes(text)) return text;
  const num = Number(text);
  if (!Number.isNaN(num) && num >= 1 && num <= 6) return roman[num - 1];
  return null;
}

function mapOverallLabelFromTotal(total) {
  if (total >= 4 && total <= 6) return "I";
  if (total >= 7 && total <= 10) return "II";
  if (total >= 11 && total <= 14) return "III";
  if (total >= 15 && total <= 18) return "IV";
  if (total >= 19 && total <= 20) return "V";
  return "N/A";
}

function attachEntryInput(input, path, { parser } = {}) {
  if (!input) return;
  if (input.dataset.entryBound === "true") {
    return;
  }
  input.dataset.entryPath = path;
  const eventName =
    input.type === "number" || input.tagName === "SELECT" ? "change" : "blur";
  const handler = () => {
    if (!state.director.entryDraft) return;
    const raw = input.type === "number" ? Number(input.value || 0) : input.value;
    const value = parser ? parser(raw) : raw;
    setValueAtPath(state.director.entryDraft, path, value);
    markDirectorDirty("entry");
  };
  input.addEventListener(eventName, handler);
  input.dataset.entryBound = "true";
}

function updateRepertoirePreview(wrapper, key) {
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

function renderRepertoireFields() {
  if (!els.repertoireFields || !state.director.entryDraft) return;
  els.repertoireFields.innerHTML = "";
  REPERTOIRE_FIELDS.forEach((piece) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
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
      const currentLevel = state.director.entryDraft.repertoire?.[piece.key]?.gradeLevel;
      gradeSelect.value = currentLevel ? String(currentLevel) : "";
      gradeSelect.addEventListener("change", () => {
        const level = gradeSelect.value ? Number(gradeSelect.value) : null;
        state.director.entryDraft.repertoire[piece.key].gradeLevel = level;
        markDirectorDirty("repertoire");
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
      titleInput.value =
        state.director.entryDraft.repertoire?.[piece.key]?.titleText || "";
      titleInput.addEventListener("input", () => {
        state.director.entryDraft.repertoire[piece.key].titleText =
          titleInput.value.trim();
        markDirectorDirty("repertoire");
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
      titleInput.value =
        state.director.entryDraft.repertoire?.[piece.key]?.titleText || "";
      titleInput.addEventListener("input", () => {
        state.director.entryDraft.repertoire[piece.key].titleText =
          titleInput.value.trim();
        markDirectorDirty("repertoire");
      });
      wrapper.appendChild(titleLabel);
    }

    const composerLabel = document.createElement("label");
    composerLabel.textContent = `${piece.label} Composer/Arranger`;
    const composerInputEl = document.createElement("input");
    composerInputEl.type = "text";
    composerLabel.appendChild(composerInputEl);
    const composerInput = composerInputEl;
    composerInput.value =
      state.director.entryDraft.repertoire?.[piece.key]?.composerArrangerText || "";
    composerInput.addEventListener("input", () => {
      state.director.entryDraft.repertoire[piece.key].composerArrangerText =
        composerInput.value.trim();
      markDirectorDirty("repertoire");
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

function renderInstrumentationStandard() {
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
      markDirectorDirty("instrumentation");
    });
    els.instrumentationStandard.appendChild(label);
  });
}

function renderInstrumentationNonStandard() {
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
      markDirectorDirty("instrumentation");
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
      markDirectorDirty("instrumentation");
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      state.director.entryDraft.instrumentation.nonStandard.splice(index, 1);
      renderInstrumentationNonStandard();
      markDirectorDirty("instrumentation");
    });

    wrapper.appendChild(nameLabel);
    wrapper.appendChild(countLabel);
    wrapper.appendChild(removeBtn);
    els.instrumentationNonStandard.appendChild(wrapper);
  });
}

function renderRule3cRows() {
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
      markDirectorDirty("rule3c");
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
      markDirectorDirty("rule3c");
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
      markDirectorDirty("rule3c");
    });

    wrapper.appendChild(studentLabel);
    wrapper.appendChild(instrumentLabel);
    wrapper.appendChild(ensembleLabel);
    els.rule3cRows.appendChild(wrapper);
  });
}

function renderSeatingRows() {
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
      markDirectorDirty("seating");
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
      markDirectorDirty("seating");
    });

    wrapper.appendChild(chairsLabel);
    wrapper.appendChild(standsLabel);
    els.seatingRows.appendChild(wrapper);
  });
}

function renderPercussionOptions() {
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
      markDirectorDirty("percussion");
    });
    const text = document.createElement("span");
    text.textContent = item;
    label.appendChild(checkbox);
    label.appendChild(text);
    els.percussionOptions.appendChild(label);
  });
}

function renderDirectorEntryForm() {
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
      markDirectorDirty("instrumentation");
    };
  }
  if (els.otherInstrumentationNotesInput) {
    els.otherInstrumentationNotesInput.value =
      state.director.entryDraft.instrumentation?.otherInstrumentationNotes || "";
    els.otherInstrumentationNotesInput.oninput = () => {
      state.director.entryDraft.instrumentation.otherInstrumentationNotes =
        els.otherInstrumentationNotesInput.value || "";
      markDirectorDirty("instrumentation");
    };
  }
  if (els.rule3cNotesInput) {
    els.rule3cNotesInput.value = state.director.entryDraft.rule3c?.notes || "";
    els.rule3cNotesInput.oninput = () => {
      state.director.entryDraft.rule3c.notes = els.rule3cNotesInput.value || "";
      markDirectorDirty("rule3c");
    };
  }
  if (els.seatingNotesInput) {
    els.seatingNotesInput.value = state.director.entryDraft.seating?.notes || "";
    els.seatingNotesInput.oninput = () => {
      state.director.entryDraft.seating.notes = els.seatingNotesInput.value || "";
      markDirectorDirty("seating");
    };
  }
  if (els.percussionNotesInput) {
    els.percussionNotesInput.value =
      state.director.entryDraft.percussionNeeds?.notes || "";
    els.percussionNotesInput.oninput = () => {
      state.director.entryDraft.percussionNeeds.notes =
        els.percussionNotesInput.value || "";
      markDirectorDirty("percussion");
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
      markDirectorDirty("lunch");
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
      markDirectorDirty("lunch");
    };
  }
  if (els.lunchNotesInput) {
    els.lunchNotesInput.value = state.director.entryDraft.lunchOrder?.notes || "";
    els.lunchNotesInput.oninput = () => {
      state.director.entryDraft.lunchOrder.notes = els.lunchNotesInput.value || "";
      markDirectorDirty("lunch");
    };
  }

  renderRepertoireFields();
  renderInstrumentationStandard();
  renderInstrumentationNonStandard();
  renderRule3cRows();
  renderSeatingRows();
  renderPercussionOptions();
}

function setDirectorEntryHint(message) {
  if (!els.directorEntryHint) return;
  els.directorEntryHint.textContent = message || "";
}

async function ensureEntryDocExists() {
  if (!state.director.entryRef || !state.director.entryDraft) return false;
  if (state.director.entryExists) return true;
  const base = buildDefaultEntry({
    eventId: state.director.selectedEventId,
    schoolId: state.auth.userProfile?.schoolId || "",
    ensembleId: state.director.selectedEnsembleId,
    createdByUid: state.auth.currentUser?.uid || "",
  });
  const payload = {
    ...base,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  await setDoc(state.director.entryRef, payload, { merge: true });
  state.director.entryExists = true;
  state.director.entryDraft = normalizeEntryData(payload, base);
  return true;
}

async function saveEntrySection(
  section,
  payload,
  successMessage,
  { button, statusEl } = {}
) {
  if (!state.director.entryRef) return;
  if (state.director.entrySaveInFlight) return;
  state.director.entrySaveInFlight = true;
  try {
    setDirectorSaveStatus("Saving...");
    await ensureEntryDocExists();
    await updateDoc(state.director.entryRef, {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    clearDirectorDirty(section);
    setDirectorSaveStatus(successMessage || "Saved.");
    if (statusEl) showStatusMessage(statusEl, "Saved.");
  } catch (error) {
    console.error("Entry save failed", error);
    setDirectorSaveStatus("Save failed. Try again.");
    if (statusEl) {
      const message = error?.message ? `Error: ${error.message}` : "Error saving.";
      showStatusMessage(statusEl, message, "error");
    }
  } finally {
    state.director.entrySaveInFlight = false;
  }
}

function buildRepertoirePayload() {
  const repertoire = state.director.entryDraft.repertoire || {};
  ["selection1", "selection2"].forEach((key) => {
    const level = repertoire[key]?.gradeLevel
      ? Number(repertoire[key].gradeLevel)
      : null;
    repertoire[key].gradeLevel = level;
  });
  return repertoire;
}

async function saveRepertoireSection() {
  if (!state.director.entryDraft) return;
  const button = els.saveRepertoireBtn;
  const statusEl = els.saveRepertoireStatus;
  const selection1Level = state.director.entryDraft.repertoire?.selection1?.gradeLevel;
  const selection2Level = state.director.entryDraft.repertoire?.selection2?.gradeLevel;
  const selection1Title = state.director.entryDraft.repertoire?.selection1?.titleText?.trim();
  const selection2Title = state.director.entryDraft.repertoire?.selection2?.titleText?.trim();
  const derived = derivePerformanceGrade(selection1Level, selection2Level);
  if (!derived.ok) {
    setPerformanceGradeError(derived.error);
    alert(derived.error);
    return;
  }
  setPerformanceGradeError("");
  if (!selection1Title || !selection2Title) {
    alert("Enter titles for Selection #1 and Selection #2.");
    return;
  }
  const marchTitle = state.director.entryDraft.repertoire?.march?.titleText?.trim();
  if (!marchTitle) {
    alert("March title is required.");
    return;
  }
  const repertoire = buildRepertoirePayload();
  state.director.entryDraft.repertoire = repertoire;
  state.director.entryDraft.performanceGrade = derived.value;
  if (els.directorPerformanceGradeInput) {
    els.directorPerformanceGradeInput.value = derived.value;
  }
  await saveEntrySection(
    "repertoire",
    { repertoire, performanceGrade: derived.value },
    "Repertoire saved.",
    { button, statusEl }
  );
  clearDirectorDirty("meta");
}

async function saveInstrumentationSection() {
  if (!state.director.entryDraft) return;
  const button = els.saveInstrumentationBtn || els.saveNonStandardBtn;
  const statusEl = els.saveInstrumentationStatus || els.saveNonStandardStatus;
  const instrumentation = state.director.entryDraft.instrumentation || {};
  instrumentation.totalPercussion = normalizeNumber(
    instrumentation.totalPercussion
  );
  instrumentation.standardCounts = instrumentation.standardCounts || {};
  Object.keys(instrumentation.standardCounts).forEach((key) => {
    instrumentation.standardCounts[key] = normalizeNumber(
      instrumentation.standardCounts[key]
    );
  });
  instrumentation.nonStandard = (instrumentation.nonStandard || []).map((row) => ({
    instrumentName: row.instrumentName || "",
    count: normalizeNumber(row.count),
  }));
  state.director.entryDraft.instrumentation = instrumentation;
  await saveEntrySection(
    "instrumentation",
    { instrumentation },
    "Instrument counts saved.",
    { button, statusEl }
  );
}

async function saveRule3cSection() {
  if (!state.director.entryDraft) return;
  const button = els.saveRule3cBtn;
  const statusEl = els.saveRule3cStatus;
  const rule3c = state.director.entryDraft.rule3c || {};
  rule3c.entries = ensureArrayLength(
    rule3c.entries,
    MAX_RULE3C_ENTRIES,
    () => ({
      studentNameOrIdentifier: "",
      instrument: "",
      alsoDoublesInEnsembleId: "",
    })
  );
  state.director.entryDraft.rule3c = rule3c;
  await saveEntrySection("rule3c", { rule3c }, "Rule 3C saved.", {
    button,
    statusEl,
  });
}

function computeDirectorCompletionState(entry) {
  const hasSchool = Boolean(state.auth.userProfile?.schoolId);
  const hasEnsemble = Boolean(state.director.selectedEnsembleId);
  const marchTitle = entry?.repertoire?.march?.titleText?.trim();
  const selection1Title = entry?.repertoire?.selection1?.titleText?.trim();
  const selection2Title = entry?.repertoire?.selection2?.titleText?.trim();
  const selection1Level = entry?.repertoire?.selection1?.gradeLevel;
  const selection2Level = entry?.repertoire?.selection2?.gradeLevel;
  const repertoireComplete =
    Boolean(marchTitle) &&
    Boolean(selection1Title) &&
    Boolean(selection2Title) &&
    Boolean(selection1Level) &&
    Boolean(selection2Level);
  const standardCounts = entry?.instrumentation?.standardCounts || {};
  const hasStandardCount = Object.values(standardCounts).some(
    (value) => Number(value) > 0
  );
  const instrumentationComplete = hasStandardCount;
  const gradeComputed = Boolean(entry?.performanceGrade?.trim?.());
  const ready = hasSchool && hasEnsemble && repertoireComplete && instrumentationComplete && gradeComputed;
  return {
    school: hasSchool,
    ensemble: hasEnsemble,
    repertoire: repertoireComplete,
    instrumentation: instrumentationComplete,
    grade: gradeComputed,
    ready,
  };
}

function renderStatusSummary({
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

function renderChecklist(listEl, items, status) {
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

function renderDirectorChecklist(entry) {
  if (!els.directorChecklist) return;
  const s = computeDirectorCompletionState(entry);
  const items = [
    { key: "school", label: "School" },
    { key: "ensemble", label: "Ensemble" },
    { key: "repertoire", label: "Repertoire" },
    { key: "instrumentation", label: "Instrumentation" },
    { key: "grade", label: "Grade ready" },
  ];

  const total = items.length;
  const done = items.filter((item) => Boolean(s[item.key])).length;
  renderStatusSummary({
    rootId: "directorChecklistPanel",
    title: done === total ? "Ready to submit" : "Not ready yet",
    done,
    total,
    pillText: done === total ? "Complete" : "Draft",
    hintText: done === total ? "" : `${total - done} missing`,
  });

  renderChecklist(els.directorChecklist, items, s);
}

function renderAdminReadiness() {
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

function renderJudgeReadiness() {
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

function renderJudgeTestReadiness() {
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

async function saveSeatingSection() {
  if (!state.director.entryDraft) return;
  const button = els.saveSeatingBtn;
  const statusEl = els.saveSeatingStatus;
  const seating = state.director.entryDraft.seating || {};
  seating.rows = ensureArrayLength(
    seating.rows,
    SEATING_ROWS,
    () => ({ chairs: 0, stands: 0 })
  ).map((row) => ({
    chairs: normalizeNumber(row.chairs),
    stands: normalizeNumber(row.stands),
  }));
  state.director.entryDraft.seating = seating;
  await saveEntrySection("seating", { seating }, "Seating saved.", {
    button,
    statusEl,
  });
}

async function savePercussionSection() {
  if (!state.director.entryDraft) return;
  const button = els.savePercussionBtn;
  const statusEl = els.savePercussionStatus;
  const percussionNeeds = state.director.entryDraft.percussionNeeds || {};
  percussionNeeds.selected = Array.isArray(percussionNeeds.selected)
    ? percussionNeeds.selected
    : [];
  state.director.entryDraft.percussionNeeds = percussionNeeds;
  await saveEntrySection(
    "percussion",
    { percussionNeeds },
    "Percussion needs saved.",
    { button, statusEl }
  );
}

async function saveLunchSection() {
  if (!state.director.entryDraft) return;
  const button = els.saveLunchBtn;
  const statusEl = els.saveLunchStatus;
  const lunchOrder = state.director.entryDraft.lunchOrder || {};
  lunchOrder.pepperoniQty = normalizeNumber(lunchOrder.pepperoniQty);
  lunchOrder.cheeseQty = normalizeNumber(lunchOrder.cheeseQty);
  state.director.entryDraft.lunchOrder = lunchOrder;
  await saveEntrySection("lunch", { lunchOrder }, "Lunch saved.", {
    button,
    statusEl,
  });
}

function validateEntryReady(entry) {
  const issues = [];
  if (!state.auth.userProfile?.schoolId) {
    issues.push("Select a school.");
  }
  if (!state.director.ensemblesCache.length) {
    issues.push("Create at least one ensemble.");
  }
  const marchTitle = entry.repertoire?.march?.titleText?.trim();
  if (!marchTitle) {
    issues.push("March title is required.");
  }
  ["selection1", "selection2"].forEach((key) => {
    const title = entry.repertoire?.[key]?.titleText?.trim();
    const level = entry.repertoire?.[key]?.gradeLevel;
    if (!level) {
      issues.push(`Grade level is required for ${key === "selection1" ? "Selection #1" : "Selection #2"}.`);
    }
    if (!title) {
      issues.push(`Title is required for ${key === "selection1" ? "Selection #1" : "Selection #2"}.`);
    }
  });
  if (
    !entry.instrumentation ||
    !entry.instrumentation.standardCounts ||
    !entry.seating ||
    !Array.isArray(entry.seating.rows)
  ) {
    issues.push("Instrumentation and seating counts are required.");
  }
  if (!entry.percussionNeeds || !Array.isArray(entry.percussionNeeds.selected)) {
    issues.push("Percussion needs must be saved.");
  }
  if (!entry.lunchOrder) {
    issues.push("Lunch order must be saved.");
  }
  return issues;
}

async function markEntryReady() {
  if (!state.director.entryDraft || !state.director.entryRef) return;
  state.director.entryDraft.repertoire = buildRepertoirePayload();
  const issues = validateEntryReady(state.director.entryDraft);
  if (issues.length) {
    alert(`Please complete the following before marking Ready:\n- ${issues.join("\n- ")}`);
    return;
  }
  try {
    const payload = {
      ...state.director.entryDraft,
      status: "ready",
      readyAt: serverTimestamp(),
      readyByUid: state.auth.currentUser?.uid || null,
      updatedAt: serverTimestamp(),
    };
    if (!state.director.entryExists) {
      payload.createdAt = serverTimestamp();
      await setDoc(state.director.entryRef, payload, { merge: true });
      state.director.entryExists = true;
    } else {
      await setDoc(state.director.entryRef, payload, { merge: true });
    }
    state.director.entryDraft.status = "ready";
    setDirectorEntryStatusLabel("Ready");
    setDirectorSaveStatus("Marked ready.");
    state.director.dirtySections.clear();
    if (els.directorEntryReadyBtn) {
      els.directorEntryReadyBtn.textContent = "Ready";
      els.directorEntryReadyBtn.disabled = true;
    }
    if (els.directorEntryUndoReadyBtn) {
      els.directorEntryUndoReadyBtn.classList.remove("is-hidden");
    }
  } catch (error) {
    console.error("Mark ready failed", error);
    alert("Unable to mark entry as ready. Try again.");
  }
}

async function markEntryDraft() {
  if (!state.director.entryDraft || !state.director.entryRef) return;
  try {
    await updateDoc(state.director.entryRef, {
      status: "draft",
      readyAt: null,
      readyByUid: null,
      updatedAt: serverTimestamp(),
    });
    state.director.entryDraft.status = "draft";
    setDirectorEntryStatusLabel("Draft");
    setDirectorSaveStatus("Marked draft.");
    if (els.directorEntryReadyBtn) {
      els.directorEntryReadyBtn.textContent = "Mark as Ready";
      els.directorEntryReadyBtn.disabled = false;
    }
    if (els.directorEntryUndoReadyBtn) {
      els.directorEntryUndoReadyBtn.classList.add("is-hidden");
    }
  } catch (error) {
    console.error("Mark draft failed", error);
    alert("Unable to mark draft. Try again.");
  }
}

function updateDirectorActiveEnsembleLabel() {
  if (!els.directorActiveEnsembleName) return;
  const active = state.director.ensemblesCache.find(
    (ensemble) => ensemble.id === state.director.selectedEnsembleId
  );
  els.directorActiveEnsembleName.textContent =
    active?.name || "None selected";
}

function selectDirectorEnsemble(ensembleId) {
  if (!confirmDiscardUnsaved()) {
    renderDirectorEnsembles(state.director.ensemblesCache);
    return;
  }
  state.director.selectedEnsembleId = ensembleId;
  updateDirectorActiveEnsembleLabel();
  renderDirectorEnsembles(state.director.ensemblesCache);
  loadDirectorEntry();
  renderDirectorChecklist(state.director.entryDraft);
}

async function loadDirectorEntry() {
  if (state.subscriptions.directorEntry) {
    state.subscriptions.directorEntry();
    state.subscriptions.directorEntry = null;
  }
  if (!state.auth.userProfile?.schoolId || !state.director.selectedEventId || !state.director.selectedEnsembleId) {
    state.director.entryDraft = null;
    state.director.entryExists = false;
    state.director.entryRef = null;
    setDirectorEntryHint("Select an ensemble and event to begin.");
    setDirectorSaveStatus("");
    setDirectorEntryStatusLabel("Draft");
    renderDirectorChecklist(state.director.entryDraft);
    if (els.directorEntryReadyBtn) {
      els.directorEntryReadyBtn.disabled = true;
    }
    if (els.repertoireFields) els.repertoireFields.innerHTML = "";
    if (els.instrumentationStandard) els.instrumentationStandard.innerHTML = "";
    if (els.instrumentationNonStandard) els.instrumentationNonStandard.innerHTML = "";
    if (els.rule3cRows) els.rule3cRows.innerHTML = "";
    if (els.seatingRows) els.seatingRows.innerHTML = "";
    if (els.percussionOptions) els.percussionOptions.innerHTML = "";
    return;
  }
  setDirectorEntryHint("");
  if (els.directorEntryReadyBtn) {
    els.directorEntryReadyBtn.disabled = false;
  }
  state.director.entryRef = doc(
    db,
    COLLECTIONS.events,
    state.director.selectedEventId,
    COLLECTIONS.entries,
    state.director.selectedEnsembleId
  );

  state.subscriptions.directorEntry = onSnapshot(state.director.entryRef, (snapshot) => {
    const defaults = buildDefaultEntry({
      eventId: state.director.selectedEventId,
      schoolId: state.auth.userProfile.schoolId,
      ensembleId: state.director.selectedEnsembleId,
      createdByUid: state.auth.currentUser?.uid || "",
    });
    if (hasDirectorUnsavedChanges()) {
      return;
    }
    if (!snapshot.exists()) {
      state.director.entryDraft = defaults;
      state.director.entryExists = false;
      setDirectorEntryStatusLabel("Draft");
      renderDirectorEntryForm();
      renderDirectorChecklist(state.director.entryDraft);
      state.director.dirtySections.clear();
      if (els.directorEntryReadyBtn) {
        els.directorEntryReadyBtn.textContent = "Mark as Ready";
        els.directorEntryReadyBtn.disabled = false;
      }
      if (els.directorEntryUndoReadyBtn) {
        els.directorEntryUndoReadyBtn.classList.add("is-hidden");
      }
      return;
    }
    state.director.entryExists = true;
    state.director.entryDraft = normalizeEntryData(snapshot.data(), defaults);
    setDirectorEntryStatusLabel(
      state.director.entryDraft.status === "ready" ? "Ready" : "Draft"
    );
    if (els.directorPerformanceGradeInput) {
      els.directorPerformanceGradeInput.value =
        state.director.entryDraft.performanceGrade || "";
    }
    const updatedAt = snapshot.data()?.updatedAt?.toDate?.();
    if (updatedAt) {
      setDirectorSaveStatus(`Last saved ${updatedAt.toLocaleString()}`);
    }
    renderDirectorEntryForm();
    renderDirectorChecklist(state.director.entryDraft);
    state.director.dirtySections.clear();
    if (els.directorEntryReadyBtn) {
      if (state.director.entryDraft.status === "ready") {
        els.directorEntryReadyBtn.textContent = "Ready";
        els.directorEntryReadyBtn.disabled = true;
        if (els.directorEntryUndoReadyBtn) {
          els.directorEntryUndoReadyBtn.classList.remove("is-hidden");
        }
      } else {
        els.directorEntryReadyBtn.textContent = "Mark as Ready";
        els.directorEntryReadyBtn.disabled = false;
        if (els.directorEntryUndoReadyBtn) {
          els.directorEntryUndoReadyBtn.classList.add("is-hidden");
        }
      }
    }
  });
}

function renderEntrySummary(entry) {
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

async function handleDeleteEnsemble(ensembleId, ensembleName) {
  if (!state.auth.userProfile?.schoolId) return;
  const confirmed = window.confirm(
    `Delete ensemble "${ensembleName || ensembleId}"? This cannot be undone.`
  );
  if (!confirmed) return;
  try {
    const deleteEnsemble = httpsCallable(functions, "deleteEnsemble");
    await deleteEnsemble({
      schoolId: state.auth.userProfile.schoolId,
      ensembleId,
    });
    if (state.director.selectedEnsembleId === ensembleId) {
      state.director.selectedEnsembleId = null;
      state.director.entryDraft = null;
      state.director.entryRef = null;
      state.director.entryExists = false;
      updateDirectorActiveEnsembleLabel();
      loadDirectorEntry();
    }
  } catch (error) {
    console.error("Delete ensemble failed", error);
    const message =
      error?.message || "Unable to delete ensemble. Check console for details.";
    alert(message);
  }
}

async function loadJudgeEntrySummary(entry) {
  if (!els.judgeEntrySummary) return;
  if (!state.event.active || !entry?.ensembleId) {
    els.judgeEntrySummary.textContent = "";
    return;
  }
  try {
    const entryRef = doc(
      db,
      COLLECTIONS.events,
      state.event.active.id,
      COLLECTIONS.entries,
      entry.ensembleId
    );
    const entrySnap = await getDoc(entryRef);
    if (!entrySnap.exists()) {
      els.judgeEntrySummary.textContent = "";
      return;
    }
    const defaults = buildDefaultEntry({
      eventId: state.event.active.id,
      schoolId: entry.schoolId || "",
      ensembleId: entry.ensembleId,
      createdByUid: "",
    });
    const normalized = normalizeEntryData(entrySnap.data(), defaults);
    const summary = renderEntrySummary(normalized);
    els.judgeEntrySummary.textContent = summary
      ? `Instrumentation Summary: ${summary}`
      : "";
  } catch (error) {
    console.error("Failed to load entry summary", error);
    els.judgeEntrySummary.textContent = "";
  }
}

const gradeOneLookup = window.GradeOneLookup;
const GRADE_ONE_MAP = gradeOneLookup?.GRADE_ONE_MAP || {};
const computeGradeOneKey = gradeOneLookup?.computeGradeOneKey || (() => "");

function computeOverallPacketRating(grade, stageScores, sightScore) {
  const normalizedGrade = normalizeGrade(grade);
  const stageValues = stageScores.filter((value) => Number.isFinite(value));
  if (normalizedGrade === "I") {
    if (stageValues.length !== 3) return { label: "N/A", value: null };
    const key = computeGradeOneKey(stageValues);
    const label = GRADE_ONE_MAP[key] || "N/A";
    return {
      label,
      value: label === "N/A" ? null : label,
      gradeOneKey: key,
    };
  }

  if (stageValues.length !== 3 || !Number.isFinite(sightScore)) {
    return { label: "N/A", value: null };
  }

  const [s1, s2, s3] = stageValues;
  if (s1 === s2 && s2 === s3 && [3, 4, 5].includes(s1)) {
    const unanimousLabel = ["I", "II", "III", "IV", "V"][s1 - 1] || "N/A";
    return { label: unanimousLabel, value: unanimousLabel };
  }

  const total = s1 + s2 + s3 + sightScore;
  const label = mapOverallLabelFromTotal(total);
  return { label, value: label === "N/A" ? null : label };
}

function renderCaptionForm() {
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
        markJudgeDirty();
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

function renderTestCaptionForm() {
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

function resetTestState() {
  state.judge.testAudioBlob = null;
  state.judge.testRecordingChunks = [];
  if (els.testPlayback) {
    els.testPlayback.src = "";
  }
  if (els.testTranscriptInput) {
    els.testTranscriptInput.value = "";
  }
  state.judge.testCaptions = {};
  if (els.testCaptionForm) {
    els.testCaptionForm.innerHTML = "";
  }
  if (els.testCaptionTotal) {
    els.testCaptionTotal.textContent = "0";
  }
  if (els.testFinalRating) {
    els.testFinalRating.textContent = "N/A";
  }
  if (els.testTranscribeBtn) {
    els.testTranscribeBtn.disabled = true;
  }
  if (els.testRecordingStatus) {
    els.testRecordingStatus.textContent = "";
    els.testRecordingStatus.classList.remove("recording-active");
  }
  renderJudgeTestReadiness();
}

function setTestMode(next) {
  state.judge.isTestMode = next;
  if (els.testModeToggle) {
    els.testModeToggle.textContent = next ? "Exit Test Mode" : "Enter Test Mode";
  }
  if (els.testModeContent) {
    els.testModeContent.classList.toggle("is-hidden", !next);
  }
  if (els.testFormTypeSelect) {
    els.testFormTypeSelect.disabled = !next;
  }
  if (els.submitBtn) {
    els.submitBtn.disabled = next ? true : els.submitBtn.disabled;
    els.submitBtn.textContent = next ? "Submit (disabled in Test Mode)" : "Submit";
  }
  if (els.judgeTestBadge) {
    els.judgeTestBadge.classList.toggle("is-hidden", !next);
  }
  if (els.transcribeBtn) {
    els.transcribeBtn.disabled = next ? true : els.transcribeBtn.disabled;
  }
  if (els.submissionHint) {
    if (next) {
      els.submissionHint.textContent = "Test mode active. Live submissions disabled.";
    } else if (!state.judge.selectedRosterEntry) {
      els.submissionHint.textContent = "Select an ensemble to begin.";
    }
  }
  if (next) {
    state.judge.previousFormType = state.judge.formType;
    if (els.testFormTypeSelect) {
      els.testFormTypeSelect.value = state.judge.testFormType;
    }
    state.judge.formType = state.judge.testFormType;
    renderTestCaptionForm();
  } else {
    state.judge.formType = state.judge.previousFormType;
    renderCaptionForm();
    if (state.judge.selectedRosterEntry) {
      selectRosterEntry(state.judge.selectedRosterEntry);
    }
  }
  renderJudgeReadiness();
}

function renderRosterList() {
  const search = els.rosterSearch.value.trim().toLowerCase();
  const filtered = state.event.rosterEntries.filter((entry) => {
    const timeLabel = formatPerformanceAt(entry.performanceAt) || "";
    const searchText = [entry.schoolId, entry.ensembleId, entry.ensembleName, timeLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchText.includes(search);
  });

  els.rosterList.innerHTML = "";
  filtered.forEach((entry) => {
    const performanceLabel = formatPerformanceAt(entry.performanceAt);
    const li = document.createElement("li");
    const top = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = performanceLabel || "Missing datetime";
    top.appendChild(strong);
    top.appendChild(
      document.createTextNode(` - ${entry.ensembleName || entry.ensembleId}`)
    );
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = `School: ${entry.schoolId}`;
    li.appendChild(top);
    li.appendChild(hint);
    const selectBtn = document.createElement("button");
    selectBtn.textContent = "Select";
    selectBtn.addEventListener("click", () => selectRosterEntry(entry));
    li.appendChild(selectBtn);
    els.rosterList.appendChild(li);
  });
}

async function selectRosterEntry(entry) {
  state.judge.selectedRosterEntry = entry;
  els.submissionHint.textContent = `Selected ensemble ${entry.ensembleId}.`;
  renderJudgeReadiness();
  renderCaptionForm();
  loadJudgeEntrySummary(entry);

  if (!state.event.active || !state.judge.position || !state.auth.currentUser) return;

  const submissionId = `${state.event.active.id}_${entry.ensembleId}_${state.judge.position}`;
  resetJudgeDraftState(submissionId);
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  const submissionSnap = await getDoc(submissionRef);
  if (submissionSnap.exists() && submissionSnap.data().locked) {
    els.submissionHint.textContent =
      "Submission already locked. Admin must unlock for edits.";
    els.submitBtn.disabled = true;
  } else {
    els.submitBtn.disabled = false;
  }
  if (submissionSnap.exists()) {
    lockSubmissionUI(submissionSnap.data());
  } else {
    lockSubmissionUI(null);
  }
  state.judge.currentSubmissionHasAudio =
    submissionSnap.exists() && Boolean(submissionSnap.data().audioUrl);
  updateTranscribeState();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "judge") return;
  if (state.judge.isTestMode) {
    els.submissionHint.textContent =
      "Test mode active. Submissions are disabled.";
    return;
  }
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position || !state.judge.formType) {
    alert("Missing active event, roster selection, or assignment.");
    return;
  }

  const submissionId = `${state.event.active.id}_${state.judge.selectedRosterEntry.ensembleId}_${state.judge.position}`;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  const submissionSnap = await getDoc(submissionRef);
  if (submissionSnap.exists() && submissionSnap.data().locked) {
    alert("Submission locked. Admin must unlock.");
    return;
  }
  const existingLocked = submissionSnap.exists()
    ? submissionSnap.data().locked
    : null;
  const nextLocked = submissionSnap.exists() ? existingLocked : true;

  let audioUrl = "";
  if (state.judge.audioBlob) {
    const audioRef = ref(
      storage,
      `audio/${state.auth.currentUser.uid}/${submissionId}/recording.webm`
    );
    await uploadBytes(audioRef, state.judge.audioBlob, {
      contentType: "audio/webm",
    });
    audioUrl = await getDownloadURL(audioRef);
  }

  const captionScoreTotal = calculateCaptionTotal(state.judge.captions);
  const rating = computeFinalRating(captionScoreTotal);

  const payload = {
    [FIELDS.submissions.status]: STATUSES.submitted,
    [FIELDS.submissions.locked]: nextLocked,
    [FIELDS.submissions.judgeUid]: state.auth.currentUser.uid,
    [FIELDS.submissions.judgeName]:
      state.auth.userProfile?.displayName || state.auth.currentUser.displayName || "",
    [FIELDS.submissions.judgeEmail]:
      state.auth.userProfile?.email || state.auth.currentUser.email || "",
    [FIELDS.submissions.judgeTitle]: state.auth.userProfile?.title || "",
    [FIELDS.submissions.judgeAffiliation]: state.auth.userProfile?.affiliation || "",
    [FIELDS.submissions.schoolId]: state.judge.selectedRosterEntry.schoolId,
    [FIELDS.submissions.eventId]: state.event.active.id,
    [FIELDS.submissions.ensembleId]: state.judge.selectedRosterEntry.ensembleId,
    [FIELDS.submissions.judgePosition]: state.judge.position,
    [FIELDS.submissions.formType]: state.judge.formType,
    [FIELDS.submissions.audioUrl]: audioUrl,
    [FIELDS.submissions.audioDurationSec]: state.judge.audioDurationSec,
    [FIELDS.submissions.transcript]: els.transcriptInput.value.trim(),
    [FIELDS.submissions.captions]: state.judge.captions,
    [FIELDS.submissions.captionScoreTotal]: captionScoreTotal,
    [FIELDS.submissions.computedFinalRatingJudge]: rating.value,
    [FIELDS.submissions.computedFinalRatingLabel]: rating.label,
    [FIELDS.submissions.submittedAt]: serverTimestamp(),
    [FIELDS.submissions.updatedAt]: serverTimestamp(),
  };

  if (!submissionSnap.exists()) {
    payload[FIELDS.submissions.createdAt] = serverTimestamp();
    await setDoc(submissionRef, payload);
  } else {
    await setDoc(submissionRef, payload, { merge: true });
  }

  if (nextLocked) {
    els.submissionHint.textContent = "Submitted and locked.";
  } else {
    els.submissionHint.textContent =
      "Saved (unlocked). Admin must lock when finalized.";
  }
  els.submitBtn.disabled = Boolean(nextLocked);
  state.judge.currentSubmissionHasAudio = Boolean(
    audioUrl || (submissionSnap.exists() && submissionSnap.data().audioUrl)
  );
  const submittedSnap = await getDoc(submissionRef);
  if (submittedSnap.exists()) {
    lockSubmissionUI(submittedSnap.data());
  }
  updateTranscribeState();
  resetJudgeDraftState(submissionId);
}

function bindAuthHandlers() {
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

  els.emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setRoleHint("");
    try {
      await signInWithEmailAndPassword(
        auth,
        els.emailInput.value,
        els.passwordInput.value
      );
    } catch (error) {
      console.error("Email sign-in failed", error);
      setRoleHint("Sign-in failed. Check email/password or reset your password.");
    }
  });

  if (els.anonymousBtn) {
    if (!DEV_FLAGS.allowAnonymousSignIn) {
      els.anonymousBtn.style.display = "none";
    } else {
      els.anonymousBtn.addEventListener("click", async () => {
        await signInAnonymously(auth);
      });
    }
  }

  if (els.forgotPasswordBtn) {
    els.forgotPasswordBtn.addEventListener("click", async () => {
      const email = els.emailInput.value.trim();
      if (!email) {
        setRoleHint("Enter your email to request a password reset.");
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
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
      const email = els.directorEmailInput.value.trim();
      const password = els.directorPasswordInput.value.trim();
      const schoolId = els.directorSchoolSelect.value || null;
      if (!email || !password) {
        setRoleHint("Provide email and password to create a director account.");
        return;
      }
      if (!schoolId) {
        setRoleHint("Select your school to complete director signup.");
        return;
      }
      try {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        const userRef = doc(db, COLLECTIONS.users, credential.user.uid);
        await setDoc(userRef, {
          role: "director",
          roles: { director: true, judge: false, admin: false },
          schoolId,
          email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setRoleHint("Director account created.");
        els.directorEmailInput.value = "";
        els.directorPasswordInput.value = "";
        els.directorSchoolSelect.value = "";
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

  els.signOutBtn.addEventListener("click", async () => {
    await signOut(auth);
  });

  if (els.copyUidBtn) {
    els.copyUidBtn.addEventListener("click", async () => {
      if (els.provisionResult) {
        els.provisionResult.textContent = "UID display is disabled.";
      }
    });
  }

}

function bindAdminHandlers() {
  els.createEventBtn.addEventListener("click", async () => {
    els.createEventBtn.dataset.loadingLabel = "Saving...";
    els.createEventBtn.dataset.spinner = "true";
    await withLoading(els.createEventBtn, async () => {
      if (!els.eventNameInput.value.trim()) return;
      const startAtRaw = els.eventStartAtInput?.value.trim() || "";
      const endAtRaw = els.eventEndAtInput?.value.trim() || "";
      if (!startAtRaw || !endAtRaw) {
        alert("Start and end date/time are required.");
        return;
      }
      const startAtDate = new Date(startAtRaw);
      const endAtDate = new Date(endAtRaw);
      if (
        Number.isNaN(startAtDate.getTime()) ||
        Number.isNaN(endAtDate.getTime())
      ) {
        alert("Invalid start or end date/time.");
        return;
      }
      if (endAtDate <= startAtDate) {
        alert("End date/time must be after start date/time.");
        return;
      }
      await addDoc(collection(db, COLLECTIONS.events), {
        name: els.eventNameInput.value.trim(),
        isActive: false,
        startAt: Timestamp.fromDate(startAtDate),
        endAt: Timestamp.fromDate(endAtDate),
        timezone: "America/New_York",
        createdAt: serverTimestamp(),
      });
      els.eventNameInput.value = "";
      if (els.eventStartAtInput) els.eventStartAtInput.value = "";
      if (els.eventEndAtInput) els.eventEndAtInput.value = "";
    });
  });

  els.scheduleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.scheduleSubmitBtn) {
      els.scheduleSubmitBtn.dataset.loadingLabel = "Saving...";
      els.scheduleSubmitBtn.dataset.spinner = "true";
    }
    await withLoading(els.scheduleSubmitBtn, async () => {
      if (!state.event.active) {
        alert("No active event.");
        return;
      }
      const performanceAtRaw = els.performanceAtInput.value;
      const schoolId = els.scheduleSchoolSelect.value;
      const ensembleId = els.scheduleEnsembleSelect.value;
      if (!performanceAtRaw || !schoolId || !ensembleId) {
        alert("Select a performance time, school, and ensemble.");
        return;
      }
      const performanceAtDate = new Date(performanceAtRaw);
      if (Number.isNaN(performanceAtDate.getTime())) {
        alert("Invalid performance time.");
        return;
      }
      await addDoc(
        collection(db, COLLECTIONS.events, state.event.active.id, COLLECTIONS.schedule),
        {
          performanceAt: Timestamp.fromDate(performanceAtDate),
          schoolId,
          ensembleId,
          schoolName: getSchoolNameById(schoolId),
          ensembleName:
            els.scheduleEnsembleSelect.selectedOptions[0]?.textContent || ensembleId,
          createdAt: serverTimestamp(),
        }
      );
      els.scheduleForm.reset();
      if (els.scheduleEnsembleSelect) {
        els.scheduleEnsembleSelect.innerHTML = "";
      }
      if (els.scheduleEnsembleHint) {
        els.scheduleEnsembleHint.textContent = "";
      }
      updateScheduleSubmitState();
    });
  });

  if (els.scheduleSchoolSelect) {
    els.scheduleSchoolSelect.addEventListener("change", () => {
      updateScheduleEnsembles();
      updateScheduleSubmitState();
    });
  }
  if (els.scheduleEnsembleSelect) {
    els.scheduleEnsembleSelect.addEventListener("change", updateScheduleSubmitState);
  }
  if (els.performanceAtInput) {
    els.performanceAtInput.addEventListener("input", updateScheduleSubmitState);
  }

    els.assignmentsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.event.active) {
        alert("No active event.");
        return;
      }
      if (els.assignmentsError) {
        els.assignmentsError.textContent = "";
      }
      const stage1Uid = els.stage1JudgeSelect.value;
      const stage2Uid = els.stage2JudgeSelect.value;
      const stage3Uid = els.stage3JudgeSelect.value;
      const sightUid = els.sightJudgeSelect.value;
      if (!stage1Uid || !stage2Uid || !stage3Uid || !sightUid) {
        if (els.assignmentsError) {
          els.assignmentsError.textContent =
            "All judge UID fields are required before saving assignments.";
        }
        return;
      }
      const uniqueCount = new Set([stage1Uid, stage2Uid, stage3Uid, sightUid]).size;
      if (uniqueCount < 4 && els.assignmentsError) {
        els.assignmentsError.textContent =
          "Warning: A judge is selected for multiple positions.";
      }
      const assignmentsRef = doc(
        db,
        COLLECTIONS.events,
        state.event.active.id,
      COLLECTIONS.assignments,
      "positions"
    );
    await setDoc(
      assignmentsRef,
      {
        stage1Uid,
        stage2Uid,
        stage3Uid,
        sightUid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (els.assignmentsError) {
      els.assignmentsError.textContent = "Assignments saved.";
    }
  });

  if (els.schoolForm) {
    els.schoolForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth.userProfile || state.auth.userProfile.role !== "admin") {
        alert("Admin access required.");
        return;
      }
      const schoolId = els.schoolIdCreateInput.value.trim();
      const name = els.schoolNameCreateInput.value.trim();
      if (!schoolId || !name) return;
      if (els.schoolResult) {
        els.schoolResult.textContent = "Saving school...";
      }
      await setDoc(
        doc(db, COLLECTIONS.schools, schoolId),
        {
          name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (els.schoolResult) {
        els.schoolResult.textContent = `Saved ${name} (${schoolId}).`;
      }
      els.schoolForm.reset();
    });
  }

  if (els.schoolBulkBtn) {
    els.schoolBulkBtn.addEventListener("click", async () => {
      if (!state.auth.userProfile || state.auth.userProfile.role !== "admin") {
        alert("Admin access required.");
        return;
      }
      const raw = els.schoolBulkInput.value.trim();
      if (!raw) return;
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const batch = writeBatch(db);
      let count = 0;
      lines.forEach((line) => {
        const [idPart, ...nameParts] = line.split(",");
        const schoolId = (idPart || "").trim();
        const name = nameParts.join(",").trim();
        if (!schoolId || !name) return;
        batch.set(
          doc(db, COLLECTIONS.schools, schoolId),
          {
            name,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        count += 1;
      });
      if (!count) {
        if (els.schoolResult) {
          els.schoolResult.textContent =
            "No valid lines found. Use: schoolId,School Name";
        }
        return;
      }
      if (els.schoolResult) {
        els.schoolResult.textContent = "Importing schools...";
      }
      await batch.commit();
      if (els.schoolResult) {
        els.schoolResult.textContent = `Imported ${count} schools.`;
      }
    });
  }

  if (els.provisionForm) {
    els.provisionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const provisionBtn = els.provisionForm.querySelector("button[type='submit']");
      if (provisionBtn) {
        provisionBtn.dataset.loadingLabel = "Saving...";
        provisionBtn.dataset.spinner = "true";
      }
      await withLoading(provisionBtn, async () => {
      if (!state.auth.userProfile || state.auth.userProfile.role !== "admin") {
        alert("Admin access required.");
        return;
      }
      const email = els.provisionEmailInput.value.trim();
      const displayName = els.provisionNameInput?.value.trim();
      const role = els.provisionRoleSelect.value;
      const schoolId = els.provisionSchoolSelect.value;
      const tempPassword = els.provisionTempPasswordInput.value.trim();
      if (!email) return;
      if (els.provisionResult) {
        els.provisionResult.textContent = "Provisioning...";
      }
      try {
        const provisionUser = httpsCallable(functions, "provisionUser");
        const response = await provisionUser({
          email,
          role,
          displayName: displayName || "",
          schoolId: role === "director" && schoolId ? schoolId : null,
          tempPassword: tempPassword || "",
        });
        const data = response.data || {};
        const passwordNote = data.generatedPassword
          ? ` Temporary password: ${data.generatedPassword}`
          : tempPassword
          ? " Temporary password set."
          : "";
        if (els.provisionResult) {
          els.provisionResult.textContent = `Provisioned ${data.email || email} (${data.role}).${passwordNote}`;
        }
        els.provisionForm.reset();
      } catch (error) {
        console.error("Provision user failed", error);
        if (els.provisionResult) {
          els.provisionResult.textContent =
            "Provisioning failed. See console for details.";
        }
      }
      });
    });
  }

  updateScheduleEnsembles();
  updateScheduleSubmitState();
}

function bindJudgeHandlers() {
  els.rosterSearch.addEventListener("input", renderRosterList);
  els.submissionForm.addEventListener("submit", async (event) => {
    if (els.submitBtn) {
      els.submitBtn.dataset.loadingLabel = "Submitting...";
      els.submitBtn.dataset.spinner = "true";
    }
    await withLoading(els.submitBtn, () => handleSubmit(event));
  });
  if (els.transcriptInput) {
    els.transcriptInput.addEventListener("input", () => {
      markJudgeDirty();
      renderJudgeReadiness();
    });
  }

  els.recordBtn.addEventListener("click", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.judge.recordingChunks = [];
    state.judge.mediaRecorder = new MediaRecorder(stream);
    state.judge.mediaRecorder.ondataavailable = (event) => {
      state.judge.recordingChunks.push(event.data);
    };
      state.judge.mediaRecorder.onstop = () => {
        state.judge.audioBlob = new Blob(state.judge.recordingChunks, { type: "audio/webm" });
        const url = URL.createObjectURL(state.judge.audioBlob);
        els.playback.src = url;
        els.recordingStatus.textContent = "Recording ready";
        els.recordingStatus.classList.remove("recording-active");
        state.judge.currentSubmissionHasAudio = true;
        updateTranscribeState();
        renderJudgeReadiness();
      };
      state.judge.mediaRecorder.start();
      els.recordBtn.disabled = true;
      els.stopBtn.disabled = false;
      els.recordingStatus.textContent = "Recording...";
      els.recordingStatus.classList.add("recording-active");
    });

  els.stopBtn.addEventListener("click", () => {
      if (state.judge.mediaRecorder && state.judge.mediaRecorder.state !== "inactive") {
        state.judge.mediaRecorder.stop();
      }
      els.recordBtn.disabled = false;
      els.stopBtn.disabled = true;
    });

  els.playback.addEventListener("loadedmetadata", () => {
    state.judge.audioDurationSec = Number(els.playback.duration.toFixed(2));
  });

  if (els.testModeToggle) {
    els.testModeToggle.addEventListener("click", () => {
      setTestMode(!state.judge.isTestMode);
      if (!state.judge.isTestMode) {
        resetTestState();
      }
    });
  }

  if (els.testFormTypeSelect) {
    els.testFormTypeSelect.addEventListener("change", () => {
      state.judge.testFormType = els.testFormTypeSelect.value;
      if (state.judge.isTestMode) {
        renderTestCaptionForm();
      }
      renderJudgeTestReadiness();
    });
  }

  if (els.testRecordBtn) {
    els.testRecordBtn.addEventListener("click", async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.judge.testRecordingChunks = [];
      state.judge.testMediaRecorder = new MediaRecorder(stream);
      state.judge.testMediaRecorder.ondataavailable = (event) => {
        state.judge.testRecordingChunks.push(event.data);
      };
      state.judge.testMediaRecorder.onstop = () => {
        state.judge.testAudioBlob = new Blob(state.judge.testRecordingChunks, { type: "audio/webm" });
        const url = URL.createObjectURL(state.judge.testAudioBlob);
        if (els.testPlayback) {
          els.testPlayback.src = url;
        }
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Recording ready";
          els.testRecordingStatus.classList.remove("recording-active");
        }
        updateTestTranscribeState();
        renderJudgeTestReadiness();
      };
      state.judge.testMediaRecorder.start();
      els.testRecordBtn.disabled = true;
      if (els.testStopBtn) {
        els.testStopBtn.disabled = false;
      }
        if (els.testRecordingStatus) {
          els.testRecordingStatus.textContent = "Recording...";
          els.testRecordingStatus.classList.add("recording-active");
        }
      });
    }

  if (els.testStopBtn) {
    els.testStopBtn.addEventListener("click", () => {
      if (state.judge.testMediaRecorder && state.judge.testMediaRecorder.state !== "inactive") {
        state.judge.testMediaRecorder.stop();
      }
        if (els.testRecordBtn) {
          els.testRecordBtn.disabled = false;
        }
        els.testStopBtn.disabled = true;
        if (els.testRecordingStatus) {
          els.testRecordingStatus.classList.remove("recording-active");
        }
      });
    }

  if (els.testTranscribeBtn) {
    els.testTranscribeBtn.addEventListener("click", async () => {
      if (!state.judge.testAudioBlob) return;
      const label = els.testTranscribeBtn.textContent;
      els.testTranscribeBtn.textContent = "Transcribing...";
      els.testTranscribeBtn.disabled = true;
      try {
        const audioBase64 = await blobToBase64(state.judge.testAudioBlob);
        const transcribeTestAudio = httpsCallable(functions, "transcribeTestAudio");
        const response = await transcribeTestAudio({
          audioBase64,
          mimeType: state.judge.testAudioBlob.type || "audio/webm",
        });
        const transcript = response.data?.transcript || "";
        if (els.testTranscriptInput) {
          els.testTranscriptInput.value = transcript;
        }
      } catch (error) {
        console.error("Test transcription failed", error);
        alert("Test transcription failed. See console for details.");
      } finally {
        els.testTranscribeBtn.textContent = label;
        updateTestTranscribeState();
        renderJudgeTestReadiness();
      }
    });
  }

  if (els.testTranscriptInput) {
    els.testTranscriptInput.addEventListener("input", () => {
      renderJudgeTestReadiness();
    });
  }

  if (els.testDraftBtn) {
    els.testDraftBtn.addEventListener("click", async () => {
      const transcript = els.testTranscriptInput?.value.trim() || "";
      if (!state.judge.testFormType) return;
      const parseTranscript = httpsCallable(functions, "parseTranscript");
      try {
        const response = await parseTranscript({ formType: state.judge.testFormType, transcript });
        const drafts = response.data?.captions || {};
        if (response.data?.draftError) {
          alert("Caption drafting unavailable; please type manually.");
        }
        Object.entries(drafts).forEach(([key, value]) => {
          const captionBlock = Array.from(els.testCaptionForm.children).find(
            (block) => block.dataset.key === key
          );
          if (captionBlock) {
            const textarea = captionBlock.querySelector("textarea");
            const text =
              typeof value === "string" ? value : value?.draft || value?.text || "";
            if (textarea) textarea.value = text || "";
          }
          if (state.judge.testCaptions[key]) {
            const text =
              typeof value === "string" ? value : value?.draft || value?.text || "";
            state.judge.testCaptions[key].comment = text || "";
          }
        });
        renderJudgeTestReadiness();
      } catch (error) {
        console.error("Test drafting failed", error);
        alert("Caption drafting unavailable; please type manually.");
      }
    });
  }

  if (els.testClearBtn) {
    els.testClearBtn.addEventListener("click", () => {
      resetTestState();
    });
  }

  if (els.transcribeBtn) {
    els.transcribeBtn.addEventListener("click", async () => {
      if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position) return;
      const label = els.transcribeBtn.textContent;
      els.transcribeBtn.disabled = true;
      els.transcribeBtn.textContent = "Transcribing...";
      try {
        let transcript = "";
        if (state.judge.currentSubmissionHasAudio && !state.judge.audioBlob) {
          const transcribeSubmissionAudio = httpsCallable(
            functions,
            "transcribeSubmissionAudio"
          );
          const response = await transcribeSubmissionAudio({
            eventId: state.event.active.id,
            ensembleId: state.judge.selectedRosterEntry.ensembleId,
            judgePosition: state.judge.position,
          });
          transcript = response.data?.transcript || "";
        } else if (state.judge.audioBlob) {
          const audioBase64 = await blobToBase64(state.judge.audioBlob);
          const transcribeTestAudio = httpsCallable(functions, "transcribeTestAudio");
          const response = await transcribeTestAudio({
            audioBase64,
            mimeType: state.judge.audioBlob.type || "audio/webm",
          });
          transcript = response.data?.transcript || "";
        }
        els.transcriptInput.value = transcript;
        markJudgeDirty();
      } catch (error) {
        console.error("Transcription failed", error);
        alert("Transcription failed. See console for details.");
      } finally {
        els.transcribeBtn.textContent = label;
        updateTranscribeState();
      }
    });
  }

  els.draftBtn.addEventListener("click", async () => {
    if (!state.judge.formType) {
      alert("No form type set yet.");
      return;
    }
    const transcript = els.transcriptInput.value.trim();
    const parseTranscript = httpsCallable(functions, "parseTranscript");
    const label = els.draftBtn.textContent;
    els.draftBtn.disabled = true;
    els.draftBtn.textContent = "Drafting...";
    if (els.draftStatus) els.draftStatus.textContent = "";
    try {
      const response = await parseTranscript({ formType: state.judge.formType, transcript });
      const drafts = response.data?.captions || {};
      if (response.data?.draftError && els.draftStatus) {
        els.draftStatus.textContent = "Caption drafting unavailable; please type manually.";
      }
      const overwrite = Boolean(els.overwriteCaptionsToggle?.checked);
      Object.entries(drafts).forEach(([key, value]) => {
        const text =
          typeof value === "string" ? value : value?.draft || value?.text || "";
        if (!text) return;
        const captionBlock = Array.from(els.captionForm.children).find(
          (block) => block.dataset.key === key
        );
        if (!captionBlock) return;
        const textarea = captionBlock.querySelector("textarea");
        const existing = textarea?.value?.trim() || "";
        if (!overwrite && existing) return;
        if (textarea) textarea.value = text;
        if (state.judge.captions[key]) {
          state.judge.captions[key].comment = text;
        }
      });
      markJudgeDirty();
      if (els.draftStatus && !response.data?.draftError) {
        els.draftStatus.textContent = "Drafted.";
      }
    } catch (error) {
      console.error("Draft captions failed", error);
      if (els.draftStatus) {
        els.draftStatus.textContent =
          "Caption drafting unavailable; please type manually.";
      }
    } finally {
      els.draftBtn.textContent = label;
      els.draftBtn.disabled = false;
    }
  });
}

function watchEvents() {
  if (state.subscriptions.events) state.subscriptions.events();
  const eventsQuery = query(collection(db, COLLECTIONS.events));
  state.subscriptions.events = onSnapshot(eventsQuery, (snapshot) => {
    state.event.list = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    state.event.list.sort((a, b) => {
      const aTime = a.startAt?.toMillis ? a.startAt.toMillis() : 0;
      const bTime = b.startAt?.toMillis ? b.startAt.toMillis() : 0;
      return aTime - bTime;
    });
    if (els.eventList) {
      els.eventList.innerHTML = "";
    }
    state.event.list.forEach((data) => {
      const startLabel = data.startAt ? formatPerformanceAt(data.startAt) : "";
      const endLabel = data.endAt ? formatPerformanceAt(data.endAt) : "";
      const dateLabel =
        startLabel && endLabel ? ` (${startLabel} to ${endLabel})` : "";
      const li = document.createElement("li");
      const title = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = data.name || "Untitled";
      title.appendChild(strong);
      if (dateLabel) {
        title.appendChild(document.createTextNode(` ${dateLabel}`));
      }
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = data.isActive ? "Active" : "Inactive";
      li.appendChild(title);
      li.appendChild(hint);
      const button = document.createElement("button");
      button.textContent = "Set Active";
      button.addEventListener("click", () => setActiveEvent(data.id));
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete Event";
      deleteBtn.addEventListener("click", async () => {
        if (!state.auth.userProfile || state.auth.userProfile.role !== "admin") {
          alert("Admin access required.");
          return;
        }
        const ok = window.confirm(
          `Delete event "${data.name || data.id}"? This cannot be undone.`
        );
        if (!ok) return;
        try {
          const deleteEvent = httpsCallable(functions, "deleteEvent");
          await deleteEvent({ eventId: data.id });
        } catch (error) {
          console.error("Delete event failed", error);
          const message =
            error?.message || "Unable to delete event. Check console for details.";
          alert(message);
        }
      });
      li.appendChild(button);
      li.appendChild(deleteBtn);
      els.eventList.appendChild(li);
    });
    renderDirectorEventOptions();
    if (!state.director.selectedEventId && state.event.active?.id) {
      state.director.selectedEventId = state.event.active.id;
      if (els.directorEventSelect) {
        els.directorEventSelect.value = state.director.selectedEventId;
      }
    }
    updateDirectorEventMeta();
  });
}

async function setActiveEvent(eventId) {
  const eventsSnap = await getDocs(collection(db, COLLECTIONS.events));
  const batch = writeBatch(db);
  eventsSnap.forEach((eventDoc) => {
    batch.update(eventDoc.ref, {
      isActive: eventDoc.id === eventId,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

function watchActiveEvent() {
  if (state.subscriptions.activeEvent) state.subscriptions.activeEvent();
  const activeQuery = query(
    collection(db, COLLECTIONS.events),
    where(FIELDS.events.isActive, "==", true)
  );

  state.subscriptions.activeEvent = onSnapshot(activeQuery, (snapshot) => {
    state.event.active = snapshot.docs[0]
      ? { id: snapshot.docs[0].id, ...snapshot.docs[0].data() }
      : null;
    if (state.event.active) {
      const startLabel = state.event.active.startAt ? formatPerformanceAt(state.event.active.startAt) : "";
      const endLabel = state.event.active.endAt ? formatPerformanceAt(state.event.active.endAt) : "";
      const dateLabel = startLabel && endLabel ? ` • ${startLabel} → ${endLabel}` : "";
      els.activeEventDisplay.textContent = `${state.event.active.name || "Active"} (${state.event.active.id})${dateLabel}`;
    } else {
      els.activeEventDisplay.textContent = "No active event.";
    }
    if (!state.director.selectedEventId && state.event.active?.id) {
      state.director.selectedEventId = state.event.active.id;
      if (els.directorEventSelect) {
        els.directorEventSelect.value = state.director.selectedEventId;
      }
      updateDirectorEventMeta();
      loadDirectorEntry();
    }
    updateAdminEmptyState();
    updateScheduleSubmitState();
    updateJudgeEmptyState();
    resetJudgeState();
    renderAdminReadiness();
    renderJudgeReadiness();
    watchRoster();
    watchAssignments();
  });
}

function bindDirectorHandlers() {
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
      if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) return;
      const schoolId = els.directorAttachSelect.value;
      if (!schoolId) return;
      const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
      try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          if (els.directorHint) {
            els.directorHint.textContent =
              "Account not provisioned. Contact the chair/admin.";
          }
          return;
        }
        await updateDoc(userRef, {
          schoolId,
          updatedAt: serverTimestamp(),
        });
        state.auth.userProfile.schoolId = schoolId;
        watchDirectorPackets();
        watchDirectorSchool();
        watchDirectorEnsembles();
        updateDirectorAttachUI();
        loadDirectorEntry();
      } catch (error) {
        console.error("Attach school failed", error);
        if (els.directorHint) {
          els.directorHint.textContent = "Unable to attach school. Try again.";
        }
      }
    });
  }

  if (els.directorDetachBtn) {
    els.directorDetachBtn.addEventListener("click", async () => {
      if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) return;
      const ok = window.confirm("Change school? This will clear your current selection.");
      if (!ok) return;
      const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
      try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          if (els.directorHint) {
            els.directorHint.textContent =
              "Account not provisioned. Contact the chair/admin.";
          }
          return;
        }
        await updateDoc(userRef, {
          schoolId: null,
          updatedAt: serverTimestamp(),
        });
        state.auth.userProfile.schoolId = null;
        watchDirectorPackets();
        watchDirectorSchool();
        watchDirectorEnsembles();
        updateDirectorAttachUI();
        state.director.selectedEnsembleId = null;
        state.director.entryDraft = null;
        state.director.entryRef = null;
        renderDirectorChecklist(state.director.entryDraft);
        setDirectorEntryHint("Select an ensemble and event to begin.");
      } catch (error) {
        console.error("Detach school failed", error);
        if (els.directorHint) {
          els.directorHint.textContent = "Unable to detach school. Try again.";
        }
      }
    });
  }

  if (els.directorEnsembleForm) {
    els.directorEnsembleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) return;
      if (!state.auth.userProfile.schoolId) return;
      const name = els.directorEnsembleNameInput.value.trim();
      if (!name) {
        if (els.directorEnsembleError) {
          els.directorEnsembleError.textContent = "Ensemble name is required.";
        }
        return;
      }
      if (els.directorEnsembleError) {
        els.directorEnsembleError.textContent = "";
      }
      const ensemblesRef = collection(
        db,
        COLLECTIONS.schools,
        state.auth.userProfile.schoolId,
        "ensembles"
      );
      const docRef = await addDoc(ensemblesRef, {
        name,
        schoolId: state.auth.userProfile.schoolId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: state.auth.currentUser.uid,
      });
      els.directorEnsembleForm.reset();
      els.directorEnsembleForm.classList.add("is-hidden");
      state.director.selectedEnsembleId = docRef.id;
      updateDirectorActiveEnsembleLabel();
      loadDirectorEntry();
      renderDirectorChecklist(state.director.entryDraft);
    });
  }

  if (els.directorEventSelect) {
    els.directorEventSelect.addEventListener("change", () => {
      if (els.directorSetEventBtn) {
        els.directorSetEventBtn.disabled = !els.directorEventSelect.value;
      }
    });
  }

  if (els.directorScheduleBtn) {
    els.directorScheduleBtn.addEventListener("click", () => {
      if (!state.director.selectedEventId) return;
      if (!confirmDiscardUnsaved()) return;
      window.location.hash = `#event/${state.director.selectedEventId}`;
      handleHashChange();
    });
  }

  if (els.directorChangeEventBtn) {
    els.directorChangeEventBtn.addEventListener("click", () => {
      if (els.directorEventPicker) {
        const isHidden = els.directorEventPicker.classList.contains("is-hidden");
        if (!isHidden && !confirmDiscardUnsaved()) return;
        els.directorEventPicker.classList.toggle("is-hidden");
      }
    });
  }

  if (els.directorSetEventBtn) {
    els.directorSetEventBtn.addEventListener("click", () => {
      const nextId = els.directorEventSelect?.value || null;
      if (!nextId) return;
      if (!confirmDiscardUnsaved()) return;
      state.director.selectedEventId = nextId;
      updateDirectorEventMeta();
      loadDirectorEntry();
      renderDirectorChecklist(state.director.entryDraft);
      if (els.directorEventPicker) {
        els.directorEventPicker.classList.add("is-hidden");
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
      markDirectorDirty("instrumentation");
    });
  }

  if (els.directorEntryReadyBtn) {
    els.directorEntryReadyBtn.addEventListener("click", markEntryReady);
  }
  if (els.directorEntryUndoReadyBtn) {
    els.directorEntryUndoReadyBtn.addEventListener("click", markEntryDraft);
  }

  if (els.saveRepertoireBtn) {
    els.saveRepertoireBtn.addEventListener("click", async () => {
      els.saveRepertoireBtn.dataset.loadingLabel = "Saving...";
      els.saveRepertoireBtn.dataset.spinner = "true";
      await withLoading(els.saveRepertoireBtn, saveRepertoireSection);
    });
  }
  if (els.saveInstrumentationBtn) {
    els.saveInstrumentationBtn.addEventListener("click", async () => {
      els.saveInstrumentationBtn.dataset.loadingLabel = "Saving...";
      els.saveInstrumentationBtn.dataset.spinner = "true";
      await withLoading(els.saveInstrumentationBtn, saveInstrumentationSection);
    });
  }
  if (els.saveNonStandardBtn) {
    els.saveNonStandardBtn.addEventListener("click", async () => {
      els.saveNonStandardBtn.dataset.loadingLabel = "Saving...";
      els.saveNonStandardBtn.dataset.spinner = "true";
      await withLoading(els.saveNonStandardBtn, saveInstrumentationSection);
    });
  }
  if (els.saveRule3cBtn) {
    els.saveRule3cBtn.addEventListener("click", async () => {
      els.saveRule3cBtn.dataset.loadingLabel = "Saving...";
      els.saveRule3cBtn.dataset.spinner = "true";
      await withLoading(els.saveRule3cBtn, saveRule3cSection);
    });
  }
  if (els.saveSeatingBtn) {
    els.saveSeatingBtn.addEventListener("click", async () => {
      els.saveSeatingBtn.dataset.loadingLabel = "Saving...";
      els.saveSeatingBtn.dataset.spinner = "true";
      await withLoading(els.saveSeatingBtn, saveSeatingSection);
    });
  }
  if (els.savePercussionBtn) {
    els.savePercussionBtn.addEventListener("click", async () => {
      els.savePercussionBtn.dataset.loadingLabel = "Saving...";
      els.savePercussionBtn.dataset.spinner = "true";
      await withLoading(els.savePercussionBtn, savePercussionSection);
    });
  }
  if (els.saveLunchBtn) {
    els.saveLunchBtn.addEventListener("click", async () => {
      els.saveLunchBtn.dataset.loadingLabel = "Saving...";
      els.saveLunchBtn.dataset.spinner = "true";
      await withLoading(els.saveLunchBtn, saveLunchSection);
    });
  }

  if (els.eventDetailBackBtn) {
    els.eventDetailBackBtn.addEventListener("click", () => {
      window.location.hash = "#director";
      handleHashChange();
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
      if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "director") return;
      const name = els.directorProfileNameInput?.value.trim() || "";
      const nafmeNumber = els.directorProfileNafmeNumberInput?.value.trim() || "";
      const expValue = els.directorProfileNafmeExpInput?.value || "";
      try {
        setDirectorProfileStatus("Saving...");
        await updateDoc(doc(db, COLLECTIONS.users, state.auth.currentUser.uid), {
          displayName: name,
          nafmeMembershipNumber: nafmeNumber,
          nafmeMembershipExp: expValue ? Timestamp.fromDate(new Date(expValue)) : null,
          updatedAt: serverTimestamp(),
        });
        state.auth.userProfile.displayName = name;
        state.auth.userProfile.nafmeMembershipNumber = nafmeNumber;
        state.auth.userProfile.nafmeMembershipExp = expValue
          ? Timestamp.fromDate(new Date(expValue))
          : null;
        if (els.directorSummaryName) {
          els.directorSummaryName.textContent = name || "Director";
        }
        setDirectorProfileStatus("Saved.");
        closeDirectorProfileModal();
      } catch (error) {
        console.error("Profile save failed", error);
        setDirectorProfileStatus("Unable to save.");
      }
    });
  }

  if (els.directorProfileCardInput) {
    els.directorProfileCardInput.addEventListener("change", async () => {
      if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "director") return;
      const file = els.directorProfileCardInput.files?.[0];
      if (!file) return;
      const extension = file.name.includes(".")
        ? file.name.split(".").pop()
        : "jpg";
      const objectPath = `director_cards/${state.auth.currentUser.uid}/membership-card.${extension}`;
      try {
        setDirectorProfileStatus("Uploading...");
        const storageRef = ref(storage, objectPath);
        await uploadBytes(storageRef, file, { contentType: file.type });
        const url = await getDownloadURL(storageRef);
        await updateDoc(doc(db, COLLECTIONS.users, state.auth.currentUser.uid), {
          nafmeCardImageUrl: url,
          nafmeCardImagePath: objectPath,
          updatedAt: serverTimestamp(),
        });
        state.auth.userProfile.nafmeCardImageUrl = url;
        state.auth.userProfile.nafmeCardImagePath = objectPath;
        renderDirectorProfile();
        setDirectorProfileStatus("Uploaded.");
      } catch (error) {
        console.error("Profile card upload failed", error);
        setDirectorProfileStatus("Upload failed.");
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

function watchSchools() {
  if (state.subscriptions.schools) state.subscriptions.schools();
  const schoolsQuery = query(collection(db, COLLECTIONS.schools), orderBy("name"));
  state.subscriptions.schools = onSnapshot(schoolsQuery, (snapshot) => {
    state.admin.schoolsList = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    refreshSchoolDropdowns();
    updateScheduleEnsembles();
    updateScheduleSubmitState();
  });
}

function formatPerformanceAt(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateHeading(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderJudgeOptions(judges) {
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

function watchJudges() {
  if (state.subscriptions.judges) state.subscriptions.judges();
  const judgesQuery = query(
    collection(db, COLLECTIONS.users),
    where(FIELDS.users.role, "==", "judge")
  );
  state.subscriptions.judges = onSnapshot(judgesQuery, (snapshot) => {
    const judges = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      const name = data.displayName || "";
      const email = data.email || "";
      const label = name && email ? `${name} — ${email}` : name || email || "Unknown judge";
      return { uid: docSnap.id, label };
    });
    judges.sort((a, b) => a.label.localeCompare(b.label));
    renderJudgeOptions(judges);
  });
}

function watchRoster() {
  if (state.subscriptions.roster) state.subscriptions.roster();
  if (!state.event.active) {
    state.event.rosterEntries = [];
    renderRosterList();
    return;
  }
  const rosterQuery = query(
    collection(db, COLLECTIONS.events, state.event.active.id, COLLECTIONS.schedule),
    orderBy("performanceAt", "asc")
  );
  state.subscriptions.roster = onSnapshot(rosterQuery, (snapshot) => {
    state.event.rosterEntries = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    renderRosterList();
    renderAdminSchedule();
  });
}

function renderAdminSchedule() {
  els.scheduleList.innerHTML = "";
  state.subscriptions.entryStatusMap.forEach((unsub) => unsub());
  state.subscriptions.entryStatusMap.clear();
  const sorted = [...state.event.rosterEntries].sort((a, b) => {
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
      const schoolName = entry.schoolName || getSchoolNameById(entry.schoolId);
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
      const entryRef = doc(
        db,
        COLLECTIONS.events,
        state.event.active.id,
        COLLECTIONS.entries,
        entry.ensembleId
      );
      const unsubscribeEntryStatus = onSnapshot(entryRef, (snap) => {
        const status = snap.exists() ? snap.data()?.status : null;
        entryStatus.textContent = status ? `Entry: ${status}` : "Entry: Not started";
      });
      state.subscriptions.entryStatusMap.set(entry.id, unsubscribeEntryStatus);

      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.className = "ghost";
      editBtn.textContent = "Edit Time";
      editBtn.addEventListener("click", async () => {
        const input = window.prompt("New performance datetime (YYYY-MM-DDTHH:mm):", "");
        if (!input) return;
        const nextDate = new Date(input);
        if (Number.isNaN(nextDate.getTime())) {
          alert("Invalid datetime.");
          return;
        }
        await updateDoc(
          doc(
            db,
            COLLECTIONS.events,
            state.event.active.id,
            COLLECTIONS.schedule,
            entry.id
          ),
          {
            performanceAt: Timestamp.fromDate(nextDate),
            updatedAt: serverTimestamp(),
          }
        );
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        const ok = window.confirm("Delete this schedule entry?");
        if (!ok) return;
        await deleteDoc(
          doc(
            db,
            COLLECTIONS.events,
            state.event.active.id,
            COLLECTIONS.schedule,
            entry.id
          )
        );
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
          await loadPacketView(entry, packetPanel);
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

async function fetchEnsembleGrade(eventId, ensembleId) {
  if (eventId) {
    const entryRef = doc(
      db,
      COLLECTIONS.events,
      eventId,
      COLLECTIONS.entries,
      ensembleId
    );
    const entrySnap = await getDoc(entryRef);
    if (entrySnap.exists()) {
      return normalizeGrade(entrySnap.data().performanceGrade);
    }
  }
  const ensembleRef = doc(db, COLLECTIONS.ensembles, ensembleId);
  const ensembleSnap = await getDoc(ensembleRef);
  if (ensembleSnap.exists()) {
    return normalizeGrade(ensembleSnap.data().performanceGrade);
  }
  return null;
}

async function fetchPacketSubmissions(eventId, ensembleId) {
  const positions = [
    JUDGE_POSITIONS.stage1,
    JUDGE_POSITIONS.stage2,
    JUDGE_POSITIONS.stage3,
    JUDGE_POSITIONS.sight,
  ];
  const submissions = {};
  await Promise.all(
    positions.map(async (position) => {
      const submissionId = `${eventId}_${ensembleId}_${position}`;
      const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
      const submissionSnap = await getDoc(submissionRef);
      submissions[position] = submissionSnap.exists()
        ? { id: submissionSnap.id, ...submissionSnap.data() }
        : null;
    })
  );
  return submissions;
}

async function fetchEntryStatus(eventId, ensembleId) {
  if (!eventId || !ensembleId) return null;
  const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId);
  const entrySnap = await getDoc(entryRef);
  if (!entrySnap.exists()) return null;
  return entrySnap.data()?.status || null;
}

function isSubmissionComplete(submission) {
  if (!submission) return false;
  if (!submission.locked) return false;
  if (submission.status !== STATUSES.submitted) return false;
  if (!submission.audioUrl) return false;
  if (!submission.captions) return false;
  if (Object.keys(submission.captions).length < 7) return false;
  if (!Number.isFinite(submission.captionScoreTotal)) return false;
  if (!Number.isFinite(submission.computedFinalRatingJudge)) return false;
  return true;
}

function computePacketSummary(grade, submissions) {
  const normalizedGrade = normalizeGrade(grade);
  const requiredPositions =
    normalizedGrade === "I"
      ? [JUDGE_POSITIONS.stage1, JUDGE_POSITIONS.stage2, JUDGE_POSITIONS.stage3]
      : [
          JUDGE_POSITIONS.stage1,
          JUDGE_POSITIONS.stage2,
          JUDGE_POSITIONS.stage3,
          JUDGE_POSITIONS.sight,
        ];

  const requiredComplete = requiredPositions.every((position) =>
    isSubmissionComplete(submissions[position])
  );
  const requiredReleased = requiredPositions.every(
    (position) => submissions[position]?.status === STATUSES.released
  );

  const stageScores = [
    submissions.stage1?.computedFinalRatingJudge,
    submissions.stage2?.computedFinalRatingJudge,
    submissions.stage3?.computedFinalRatingJudge,
  ];
  const sightScore = submissions.sight?.computedFinalRatingJudge;
  const overall = computeOverallPacketRating(
    normalizedGrade,
    stageScores,
    sightScore
  );

  return {
    grade: normalizedGrade,
    requiredPositions,
    requiredComplete,
    requiredReleased,
    overall,
  };
}

function renderSubmissionCard(submission, position) {
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

async function loadPacketView(entry, targetEl = els.packetView) {
  if (!state.event.active || !targetEl) return;
  targetEl.innerHTML = "";
  const grade = await fetchEnsembleGrade(state.event.active.id, entry.ensembleId);
  const directorName = await getDirectorNameForSchool(entry.schoolId);
  const submissions = await fetchPacketSubmissions(
    state.event.active.id,
    entry.ensembleId
  );
  const summary = computePacketSummary(grade, submissions);

  const readinessPanel = document.createElement("div");
  readinessPanel.className = "panel";
  readinessPanel.innerHTML = `
    <div class="readiness-header">
      <h3>Packet Readiness</h3>
      <span class="pill"></span>
    </div>
    <div class="readiness-summary">
      <div class="readiness-main">
        <div class="readiness-title"></div>
        <div class="readiness-meta"></div>
      </div>
      <div class="readiness-actions"></div>
    </div>
    <div class="progress" aria-hidden="true">
      <div class="progress-bar" style="width: 0%"></div>
    </div>
    <details class="accordion-card readiness-details">
      <summary>
        <span>View details</span>
        <span class="muted readiness-hint"> </span>
      </summary>
      <ul class="list list--compact"></ul>
    </details>
  `;

  const readinessItems = [
    { key: "grade", label: "Grade detected" },
    { key: "complete", label: "Required submissions complete" },
    { key: "released", label: "Packet released" },
  ];
  const readinessStatus = {
    grade: Boolean(summary.grade),
    complete: summary.requiredComplete,
    released: summary.requiredReleased,
  };
  const readinessTotal = readinessItems.length;
  const readinessDone = readinessItems.filter((item) => Boolean(readinessStatus[item.key])).length;
  const readinessTitle = summary.requiredReleased
    ? "Packet released"
    : summary.requiredComplete
    ? "Ready to release"
    : "Packet incomplete";
  const readinessPill = summary.requiredReleased
    ? "Released"
    : summary.requiredComplete
    ? "Ready"
    : "Draft";

  renderStatusSummary({
    root: readinessPanel,
    title: readinessTitle,
    done: readinessDone,
    total: readinessTotal,
    pillText: readinessPill,
    hintText: readinessDone === readinessTotal ? "" : `${readinessTotal - readinessDone} missing`,
  });
  renderChecklist(
    readinessPanel.querySelector("ul"),
    readinessItems,
    readinessStatus
  );

  const header = document.createElement("div");
  header.className = "packet-header";
  const ensembleRow = document.createElement("div");
  const ensembleLabel = document.createElement("strong");
  ensembleLabel.textContent = "Ensemble:";
  ensembleRow.appendChild(ensembleLabel);
  ensembleRow.appendChild(document.createTextNode(` ${entry.ensembleId}`));
  const schoolRow = document.createElement("div");
  schoolRow.className = "note";
  schoolRow.textContent = `School: ${entry.schoolId}`;
  const directorRow = document.createElement("div");
  directorRow.className = "note";
  directorRow.textContent = `Director: ${directorName}`;
  const gradeRow = document.createElement("div");
  gradeRow.className = "note";
  gradeRow.textContent = `Grade: ${summary.grade || "Unknown"}`;
  const overallRow = document.createElement("div");
  overallRow.className = "note";
  overallRow.textContent = `Overall: ${summary.overall.label}`;
  const releasedRow = document.createElement("div");
  releasedRow.className = "note";
  releasedRow.textContent = `Released: ${summary.requiredReleased ? "yes" : "no"}`;
  header.appendChild(ensembleRow);
  header.appendChild(schoolRow);
  header.appendChild(directorRow);
  header.appendChild(gradeRow);
  header.appendChild(overallRow);
  header.appendChild(releasedRow);

  if (summary.grade === "I" && summary.overall.label === "N/A") {
    const warning = document.createElement("div");
    warning.className = "empty";
    warning.textContent = `Grade I mapping missing for key ${summary.overall.gradeOneKey || "unknown"}. Release blocked.`;
    targetEl.appendChild(warning);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const releaseBtn = document.createElement("button");
  releaseBtn.textContent = "Release Packet";
  releaseBtn.disabled =
    !summary.requiredComplete ||
    summary.requiredReleased ||
    !summary.grade ||
    (summary.grade === "I" && summary.overall.label === "N/A");
  releaseBtn.addEventListener("click", async () => {
    const releasePacket = httpsCallable(functions, "releasePacket");
    await releasePacket({
      eventId: state.event.active.id,
      ensembleId: entry.ensembleId,
    });
    await loadPacketView(entry);
  });

  const unreleaseBtn = document.createElement("button");
  unreleaseBtn.textContent = "Unrelease Packet";
  unreleaseBtn.className = "ghost";
  unreleaseBtn.disabled = !summary.requiredReleased;
  unreleaseBtn.addEventListener("click", async () => {
    const unreleasePacket = httpsCallable(functions, "unreleasePacket");
    await unreleasePacket({
      eventId: state.event.active.id,
      ensembleId: entry.ensembleId,
    });
    await loadPacketView(entry);
  });

  actions.appendChild(releaseBtn);
  actions.appendChild(unreleaseBtn);

  const grid = document.createElement("div");
  grid.className = "packet-grid";
  Object.values(JUDGE_POSITIONS).forEach((position) => {
    const submission = submissions[position];
    const card = renderSubmissionCard(submission, position);
    if (submission) {
      const lockRow = document.createElement("div");
      lockRow.className = "actions";
      const unlockBtn = document.createElement("button");
      unlockBtn.textContent = "Unlock";
      unlockBtn.className = "ghost";
      unlockBtn.disabled = submission.locked === false;
      unlockBtn.addEventListener("click", async () => {
        const unlockSubmission = httpsCallable(functions, "unlockSubmission");
        await unlockSubmission({
          eventId: state.event.active.id,
          ensembleId: entry.ensembleId,
          judgePosition: submission.judgePosition,
        });
        await loadPacketView(entry);
      });

      const lockBtn = document.createElement("button");
      lockBtn.textContent = "Lock";
      lockBtn.disabled = submission.locked === true;
      lockBtn.addEventListener("click", async () => {
        const lockSubmission = httpsCallable(functions, "lockSubmission");
        await lockSubmission({
          eventId: state.event.active.id,
          ensembleId: entry.ensembleId,
          judgePosition: submission.judgePosition,
        });
        await loadPacketView(entry);
      });

      lockRow.appendChild(unlockBtn);
      lockRow.appendChild(lockBtn);
      card.appendChild(lockRow);
    }
    grid.appendChild(card);
  });

  targetEl.appendChild(readinessPanel);
  targetEl.appendChild(header);
  targetEl.appendChild(actions);
  targetEl.appendChild(grid);
  if (!summary.requiredComplete && !summary.requiredReleased) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "Packet incomplete. Release requires all required submissions locked and submitted.";
    targetEl.appendChild(empty);
  }
}

async function renderDirectorPackets(groups) {
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

    const header = document.createElement("div");
    header.className = "packet-header";
    const directorName = await getDirectorNameForSchool(group.schoolId);
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

function watchDirectorPackets() {
  if (state.subscriptions.directorPackets) state.subscriptions.directorPackets();
  if (!state.auth.userProfile || !isDirectorManager()) {
    els.directorHint.textContent = "";
    return;
  }
  if (!state.auth.userProfile.schoolId) {
    els.directorHint.textContent = "Select a school to continue.";
    updateDirectorAttachUI();
    els.directorPackets.innerHTML = "";
    if (els.directorEmpty) {
      els.directorEmpty.style.display = "none";
    }
    return;
  }

  const submissionsQuery = query(
    collection(db, COLLECTIONS.submissions),
    where(FIELDS.submissions.schoolId, "==", state.auth.userProfile.schoolId),
    where(FIELDS.submissions.status, "==", STATUSES.released)
  );

  state.subscriptions.directorPackets = onSnapshot(submissionsQuery, async (snapshot) => {
    const grouped = {};
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const key = `${data.eventId}_${data.ensembleId}`;
      if (!grouped[key]) {
        grouped[key] = {
          eventId: data.eventId,
          ensembleId: data.ensembleId,
          schoolId: data.schoolId,
          submissions: {},
        };
      }
      grouped[key].submissions[data.judgePosition] = {
        id: docSnap.id,
        ...data,
      };
    });

    const groups = await Promise.all(
      Object.values(grouped).map(async (group) => {
        const grade = await fetchEnsembleGrade(group.eventId, group.ensembleId);
        const summary = computePacketSummary(grade, group.submissions);
        return {
          ...group,
          grade,
          overall: summary.overall,
        };
      })
    );

    renderDirectorPackets(groups);
    updateDirectorAttachUI();
  });
}

function watchDirectorSchool() {
  if (state.subscriptions.directorSchool) state.subscriptions.directorSchool();
  if (!state.auth.userProfile || !isDirectorManager()) return;
  if (!state.auth.userProfile.schoolId) {
    if (els.directorSchoolName) {
      els.directorSchoolName.textContent = "No school attached";
    }
    if (els.directorSummarySchool) {
      els.directorSummarySchool.textContent = "No school attached";
    }
    return;
  }
  const schoolRef = doc(db, COLLECTIONS.schools, state.auth.userProfile.schoolId);
  state.subscriptions.directorSchool = onSnapshot(schoolRef, (snapshot) => {
    const name = snapshot.exists() ? snapshot.data().name || snapshot.id : "Unknown school";
    if (els.directorSchoolName) {
      els.directorSchoolName.textContent = name;
    }
    if (els.directorSummarySchool) {
      els.directorSummarySchool.textContent = name;
    }
  });
}

function renderDirectorEnsembles(ensembles) {
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
    selectBtn.addEventListener("click", () => selectDirectorEnsemble(ensemble.id));
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () =>
      handleDeleteEnsemble(ensemble.id, ensemble.name)
    );
    const actions = document.createElement("div");
    actions.className = "ensemble-actions";
    actions.appendChild(selectBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);
    els.directorEnsembleList.appendChild(li);
  });
}

function watchDirectorEnsembles() {
  if (state.subscriptions.directorEnsembles) state.subscriptions.directorEnsembles();
  if (!state.auth.userProfile || !isDirectorManager()) return;
  if (!state.auth.userProfile.schoolId) {
    state.director.ensemblesCache = [];
    renderDirectorEnsembles([]);
    return;
  }
  const ensemblesRef = collection(
    db,
    COLLECTIONS.schools,
    state.auth.userProfile.schoolId,
    "ensembles"
  );
  const ensemblesQuery = query(ensemblesRef, orderBy("name"));
  state.subscriptions.directorEnsembles = onSnapshot(ensemblesQuery, (snapshot) => {
    const ensembles = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    state.director.ensemblesCache = ensembles;
    const exists = ensembles.some(
      (ensemble) => ensemble.id === state.director.selectedEnsembleId
    );
    if ((!state.director.selectedEnsembleId || !exists) && ensembles.length) {
      state.director.selectedEnsembleId = ensembles[0].id;
      updateDirectorActiveEnsembleLabel();
      loadDirectorEntry();
    }
    renderDirectorEnsembles(ensembles);
    renderRule3cRows();
  });
}

function watchAssignments() {
  if (state.subscriptions.assignments) state.subscriptions.assignments();
  if (!state.event.active) {
    state.event.assignments = null;
    state.judge.position = null;
    state.judge.formType = null;
    els.judgePositionDisplay.textContent = "";
    if (els.judgeAssignmentDetail) {
      els.judgeAssignmentDetail.textContent = "";
    }
    if (els.stage1JudgeSelect) els.stage1JudgeSelect.value = "";
    if (els.stage2JudgeSelect) els.stage2JudgeSelect.value = "";
    if (els.stage3JudgeSelect) els.stage3JudgeSelect.value = "";
    if (els.sightJudgeSelect) els.sightJudgeSelect.value = "";
    updateJudgeEmptyState();
    renderAdminReadiness();
    return;
  }

  const assignmentsRef = doc(
    db,
    COLLECTIONS.events,
    state.event.active.id,
    COLLECTIONS.assignments,
    "positions"
  );

  state.subscriptions.assignments = onSnapshot(assignmentsRef, (snapshot) => {
    state.event.assignments = snapshot.exists() ? snapshot.data() : null;
    if (!state.auth.currentUser) return;
    state.judge.position = detectJudgePosition(state.event.assignments, state.auth.currentUser.uid);
    state.judge.formType = state.judge.position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
    if (state.judge.position) {
      els.judgePositionDisplay.textContent = `Assigned Position: ${state.judge.position}`;
      els.judgeAssignmentDetail.textContent = `Form Type: ${state.judge.formType}`;
    } else {
      els.judgePositionDisplay.textContent = "No assignment found.";
      els.judgeAssignmentDetail.textContent =
        "Admin: assign a judge position for this event.";
    }
    renderCaptionForm();
    updateJudgeEmptyState();
    updateTranscribeState();
    renderAdminReadiness();
    if (state.event.assignments) {
      if (els.stage1JudgeSelect) els.stage1JudgeSelect.value = state.event.assignments.stage1Uid || "";
      if (els.stage2JudgeSelect) els.stage2JudgeSelect.value = state.event.assignments.stage2Uid || "";
      if (els.stage3JudgeSelect) els.stage3JudgeSelect.value = state.event.assignments.stage3Uid || "";
      if (els.sightJudgeSelect) els.sightJudgeSelect.value = state.event.assignments.sightUid || "";
    }
  });
}

function detectJudgePosition(assignmentsDoc, uid) {
  if (!assignmentsDoc) return null;
  if (assignmentsDoc.stage1Uid === uid) return JUDGE_POSITIONS.stage1;
  if (assignmentsDoc.stage2Uid === uid) return JUDGE_POSITIONS.stage2;
  if (assignmentsDoc.stage3Uid === uid) return JUDGE_POSITIONS.stage3;
  if (assignmentsDoc.sightUid === uid) return JUDGE_POSITIONS.sight;
  return null;
}

function stopWatchers() {
  if (state.subscriptions.events) state.subscriptions.events();
  if (state.subscriptions.activeEvent) state.subscriptions.activeEvent();
  if (state.subscriptions.roster) state.subscriptions.roster();
  if (state.subscriptions.assignments) state.subscriptions.assignments();
  if (state.subscriptions.directorPackets) state.subscriptions.directorPackets();
  if (state.subscriptions.directorSchool) state.subscriptions.directorSchool();
  if (state.subscriptions.directorEnsembles) state.subscriptions.directorEnsembles();
  if (state.subscriptions.directorEntry) state.subscriptions.directorEntry();
  if (state.subscriptions.judges) state.subscriptions.judges();
  state.subscriptions.events = null;
  state.subscriptions.activeEvent = null;
  state.subscriptions.roster = null;
  state.subscriptions.assignments = null;
  state.subscriptions.directorPackets = null;
  state.subscriptions.directorSchool = null;
  state.subscriptions.directorEnsembles = null;
  state.subscriptions.directorEntry = null;
  state.subscriptions.judges = null;
}

function startWatchers() {
  watchEvents();
  watchActiveEvent();
  watchDirectorPackets();
  watchDirectorSchool();
  watchDirectorEnsembles();
  watchJudges();
}

bindAuthHandlers();
bindAdminHandlers();
bindJudgeHandlers();
bindDirectorHandlers();
startAutosaveLoop();

function initTabs() {
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

initTabs();

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
});

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
window.addEventListener("online", updateConnectivityUI);
window.addEventListener("offline", updateConnectivityUI);
updateConnectivityUI();

window.addEventListener("hashchange", handleHashChange);
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

refreshSchoolDropdowns();
watchSchools();
handleHashChange();

onAuthStateChanged(auth, async (user) => {
  state.auth.currentUser = user;
  updateAuthUI();

  if (!user) {
    const working = hasUnsavedChanges();
    if (working) {
      state.auth.sessionExpiredLocked = true;
      stopWatchers();
      showSessionExpiredModal();
      setMainInteractionDisabled(true);
      return;
    }
    state.auth.userProfile = null;
    updateRoleUI();
    resetJudgeState();
    stopWatchers();
    setTestMode(false);
    resetTestState();
    state.director.selectedEventId = null;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    state.director.entryExists = false;
    state.director.ensemblesCache = [];
    setDirectorEntryHint("");
    setDirectorSaveStatus("");
    setDirectorEntryStatusLabel("Draft");
    els.adminCard.hidden = true;
    els.directorCard.hidden = true;
    els.adminCard.style.display = "none";
    els.directorCard.style.display = "none";
    setAuthView("signIn");
    closeAuthModal();
    return;
  }

  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(userRef);
  state.auth.userProfile = snap.exists() ? snap.data() : null;
  if (state.auth.sessionExpiredLocked) {
    state.auth.sessionExpiredLocked = false;
    hideSessionExpiredModal();
    setMainInteractionDisabled(false);
  }
  updateRoleUI();
  if (state.auth.userProfile) {
    if (state.auth.userProfile.role === "admin") {
      setTab("admin");
    } else if (state.auth.userProfile.role === "judge") {
      setTab("judge");
    } else if (state.auth.userProfile.role === "director") {
      setTab("director");
    }
    startWatchers();
    renderDirectorProfile();
  } else {
    stopWatchers();
    resetJudgeState();
  }
  closeAuthModal();
});

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  setRoleHint("Update firebaseConfig in app.js to match your project.");
}
