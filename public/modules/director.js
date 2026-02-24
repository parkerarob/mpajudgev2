import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  addDoc,
  collection,
  doc,
  fetchEnsembleGrade,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "./firestore.js";
import {
  COLLECTIONS,
  FIELDS,
  MAX_RULE3C_ENTRIES,
  STATUSES,
  REPERTOIRE_FIELDS,
  SEATING_ROWS,
  STANDARD_INSTRUMENTS,
  state,
} from "../state.js";
import { db, functions, storage } from "../firebase.js";
import {
  derivePerformanceGrade,
  ensureArrayLength,
  normalizeGrade,
  normalizeNumber,
  romanToLevel,
} from "./utils.js";
import { computePacketSummary } from "./judge.js";

export function isDirectorManager() {
  return state.auth.userProfile?.role === "director" || state.auth.userProfile?.role === "admin";
}

export function markDirectorDirty(section) {
  if (!section) return;
  state.director.dirtySections.add(section);
  state.director.draftVersion += 1;
  return computeDirectorCompletionState(state.director.entryDraft);
}

export function clearDirectorDirty(section) {
  if (!section) return;
  state.director.dirtySections.delete(section);
}

export function discardDirectorDraftChanges() {
  state.director.dirtySections.clear();
  state.director.draftVersion += 1;
}

export function hasDirectorUnsavedChanges() {
  return state.director.dirtySections.size > 0;
}

export function buildDirectorAutosavePayload() {
  const repertoire = buildRepertoirePayload();
  const mpaSelections = buildMpaSelectionsPayload(repertoire);
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
    performanceGradeFlex: Boolean(state.director.entryDraft?.performanceGradeFlex),
    repertoire,
    mpaSelections,
    instrumentation: normalizedInstrumentation,
    rule3c: normalizedRule3c,
    seating: normalizedSeating,
    percussionNeeds: normalizedPercussion,
    lunchOrder: normalizedLunch,
  };
}

export function buildDefaultEntry({ eventId, schoolId, ensembleId, createdByUid }) {
  const standardCounts = STANDARD_INSTRUMENTS.reduce((acc, item) => {
    acc[item.key] = 0;
    return acc;
  }, {});
  const defaultSelections = Array.from({ length: 2 }, () => ({
    pieceId: null,
    grade: "",
    title: "",
    composer: "",
  }));
  return {
    eventId,
    schoolId,
    ensembleId,
    createdByUid,
    status: "draft",
    performanceGrade: "",
    performanceGradeFlex: false,
    mpaSelections: defaultSelections,
    repertoire: {
      march: {
        title: "",
        composer: "",
      },
      selection1: {
        pieceId: null,
        grade: "",
        title: "",
        composer: "",
      },
      selection2: {
        pieceId: null,
        grade: "",
        title: "",
        composer: "",
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

export function normalizeEntryData(data, defaults) {
  const base = { ...defaults, ...(data || {}) };
  const mpaSelections = Array.isArray(data?.mpaSelections) ? data.mpaSelections : [];
  base.mpaSelections = Array.from({ length: 2 }, (_, index) => ({
    ...(defaults.mpaSelections?.[index] || {}),
    ...(mpaSelections[index] || {}),
  })).map((row) => ({
    pieceId: row?.pieceId || null,
    grade: normalizeGrade(row?.grade) || "",
    title: row?.title || "",
    composer: row?.composer || "",
  }));
  base.repertoire = { ...defaults.repertoire, ...(data?.repertoire || {}) };
  REPERTOIRE_FIELDS.forEach((item) => {
    const existing = data?.repertoire?.[item.key] || {};
    const fallbackSelection =
      item.key === "selection1"
        ? base.mpaSelections[0]
        : item.key === "selection2"
          ? base.mpaSelections[1]
          : null;
    const normalizedGrade =
      normalizeGrade(existing.grade) ||
      (existing.gradeLevel != null ? normalizeGrade(existing.gradeLevel) : null);
    base.repertoire[item.key] = {
      ...(defaults.repertoire[item.key] || {}),
      pieceId: existing.pieceId || existing.workId || fallbackSelection?.pieceId || null,
      grade: normalizedGrade || fallbackSelection?.grade || "",
      title: existing.title || existing.titleText || fallbackSelection?.title || "",
      composer:
        existing.composer ||
        existing.composerArrangerText ||
        fallbackSelection?.composer ||
        "",
    };
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

export async function getDirectorNameForSchool(schoolId) {
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

export async function ensureEntryDocExists() {
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

export async function saveEntrySection(section, payload, successMessage) {
  if (!state.director.entryDraft || !state.director.entryRef) {
    return { ok: false, reason: "missing-entry" };
  }
  if (state.director.entrySaveInFlight) {
    return { ok: false, reason: "in-flight" };
  }
  state.director.entrySaveInFlight = true;
  try {
    await ensureEntryDocExists();
    const wasReady = state.director.entryDraft.status === "ready";
    const updatePayload = {
      ...payload,
      updatedAt: serverTimestamp(),
    };
    if (wasReady) {
      updatePayload.status = "draft";
      updatePayload.readyAt = null;
      updatePayload.readyByUid = null;
    }
    await updateDoc(state.director.entryRef, updatePayload);
    if (wasReady) {
      state.director.entryDraft.status = "draft";
    }
    if (section) {
      state.director.dirtySections.delete(section);
    }
    return {
      ok: true,
      message: successMessage || "",
      section,
      statusChangedToDraft: wasReady,
    };
  } catch (error) {
    console.error("Save section failed", error);
    return { ok: false, error };
  } finally {
    state.director.entrySaveInFlight = false;
  }
}

export function buildRepertoirePayload() {
  const repertoire = state.director.entryDraft.repertoire || {};
  if (!repertoire.march) {
    repertoire.march = { title: "", composer: "" };
  }
  repertoire.march.title = repertoire.march?.title?.trim?.() || "";
  repertoire.march.composer = repertoire.march?.composer?.trim?.() || "";
  ["selection1", "selection2"].forEach((key) => {
    if (!repertoire[key]) {
      repertoire[key] = {
        pieceId: null,
        grade: "",
        title: "",
        composer: "",
      };
    }
    const grade = normalizeGrade(repertoire[key]?.grade);
    repertoire[key].grade = grade || "";
    repertoire[key].title = repertoire[key]?.title?.trim?.() || "";
    repertoire[key].composer = repertoire[key]?.composer?.trim?.() || "";
    repertoire[key].pieceId = repertoire[key]?.pieceId || null;
  });
  return repertoire;
}

export function buildMpaSelectionsPayload(repertoire) {
  const source = repertoire || {};
  return ["selection1", "selection2"].map((key) => ({
    pieceId: source[key]?.pieceId || null,
    grade: source[key]?.grade || "",
    title: source[key]?.title || "",
    composer: source[key]?.composer || "",
  }));
}

export async function getMpaRepertoireForGrade(grade) {
  const normalized = normalizeGrade(grade);
  if (!normalized) return [];
  if (state.director.mpaCacheByGrade.has(normalized)) {
    return state.director.mpaCacheByGrade.get(normalized);
  }
  if (state.director.mpaLoadingGrades.has(normalized)) {
    return state.director.mpaLoadingGrades.get(normalized);
  }
  const loader = (async () => {
    try {
      const repertoireQuery = query(
        collection(db, COLLECTIONS.mpaRepertoire),
        where("grade", "==", normalized)
      );
      const snap = await getDocs(repertoireQuery);
      const entries = snap.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        return {
          id: docSnap.id,
          grade: data.grade || normalized,
          title: data.title || "",
          titleLower: data.titleLower || (data.title || "").toLowerCase(),
          composer: data.composer || "",
          composerLower: data.composerLower || (data.composer || "").toLowerCase(),
          distributorPublisher: data.distributorPublisher || "",
          specialInstructions: data.specialInstructions || "",
        };
      });
      entries.sort((a, b) => a.titleLower.localeCompare(b.titleLower));
      state.director.mpaCacheByGrade.set(normalized, entries);
      return entries;
    } catch (error) {
      console.error("Failed to load MPA repertoire", error);
      return [];
    } finally {
      state.director.mpaLoadingGrades.delete(normalized);
    }
  })();
  state.director.mpaLoadingGrades.set(normalized, loader);
  return loader;
}

export async function saveRepertoireSection() {
  if (!state.director.entryDraft) return;
  const marchTitle = state.director.entryDraft.repertoire?.march?.title?.trim();
  const selection1Grade = state.director.entryDraft.repertoire?.selection1?.grade;
  const selection2Grade = state.director.entryDraft.repertoire?.selection2?.grade;
  const selection1Title = state.director.entryDraft.repertoire?.selection1?.title?.trim();
  const selection2Title = state.director.entryDraft.repertoire?.selection2?.title?.trim();
  const selection1Level = romanToLevel(selection1Grade);
  const selection2Level = romanToLevel(selection2Grade);
  const derived = derivePerformanceGrade(selection1Level, selection2Level);
  if (!derived.ok) {
    return {
      ok: false,
      reason: "validation",
      message: derived.error,
      performanceGradeError: derived.error,
    };
  }
  if (!selection1Title || !selection2Title) {
    const message = "Enter titles for Selection #1 and Selection #2.";
    return { ok: false, reason: "validation", message };
  }
  if (!selection1Grade || !selection2Grade) {
    const message = "Select grades for Selection #1 and Selection #2.";
    return { ok: false, reason: "validation", message };
  }
  if (!marchTitle) {
    const message = "March title is required.";
    return { ok: false, reason: "validation", message };
  }
  const repertoire = buildRepertoirePayload();
  const mpaSelections = buildMpaSelectionsPayload(repertoire);
  state.director.entryDraft.repertoire = repertoire;
  state.director.entryDraft.mpaSelections = mpaSelections;
  state.director.entryDraft.performanceGrade = derived.value;
  const result = await saveEntrySection(
    "repertoire",
    {
      repertoire,
      mpaSelections,
      performanceGrade: derived.value,
      performanceGradeFlex: Boolean(state.director.entryDraft.performanceGradeFlex),
    },
    "Repertoire saved."
  );
  return {
    ...result,
    performanceGrade: derived.value,
  };
}

export async function saveInstrumentationSection() {
  if (!state.director.entryDraft) return;
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
  return saveEntrySection(
    "instrumentation",
    { instrumentation },
    "Instrument counts saved."
  );
}

export async function saveRule3cSection() {
  if (!state.director.entryDraft) return;
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
  return saveEntrySection("rule3c", { rule3c }, "Rule 3C saved.");
}

export function computeDirectorCompletionState(entry) {
  const hasEnsemble = Boolean(state.director.selectedEnsembleId);
  const marchTitle = entry?.repertoire?.march?.title?.trim();
  const selection1Title = entry?.repertoire?.selection1?.title?.trim();
  const selection2Title = entry?.repertoire?.selection2?.title?.trim();
  const selection1Grade = entry?.repertoire?.selection1?.grade;
  const selection2Grade = entry?.repertoire?.selection2?.grade;
  const repertoireComplete =
    Boolean(marchTitle) &&
    Boolean(selection1Title) &&
    Boolean(selection2Title) &&
    Boolean(selection1Grade) &&
    Boolean(selection2Grade);
  const standardCounts = entry?.instrumentation?.standardCounts || {};
  const hasStandardCount = Object.values(standardCounts).some(
    (value) => Number(value) > 0
  );
  const instrumentationComplete = hasStandardCount;
  const gradeComputed = Boolean(entry?.performanceGrade?.trim?.());
  const ready = hasEnsemble && repertoireComplete && instrumentationComplete && gradeComputed;
  return {
    ensemble: hasEnsemble,
    repertoire: repertoireComplete,
    instrumentation: instrumentationComplete,
    grade: gradeComputed,
    ready,
  };
}

export async function saveSeatingSection() {
  if (!state.director.entryDraft) return;
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
  return saveEntrySection("seating", { seating }, "Seating saved.");
}

export async function savePercussionSection() {
  if (!state.director.entryDraft) return;
  const percussionNeeds = state.director.entryDraft.percussionNeeds || {};
  percussionNeeds.selected = Array.isArray(percussionNeeds.selected)
    ? percussionNeeds.selected
    : [];
  state.director.entryDraft.percussionNeeds = percussionNeeds;
  return saveEntrySection(
    "percussion",
    { percussionNeeds },
    "Percussion saved."
  );
}

export async function saveLunchSection() {
  if (!state.director.entryDraft) return;
  const lunchOrder = state.director.entryDraft.lunchOrder || {};
  lunchOrder.pepperoniQty = normalizeNumber(lunchOrder.pepperoniQty);
  lunchOrder.cheeseQty = normalizeNumber(lunchOrder.cheeseQty);
  state.director.entryDraft.lunchOrder = lunchOrder;
  return saveEntrySection("lunch", { lunchOrder }, "Lunch saved.");
}

export function validateEntryReady(entry) {
  const issues = [];
  if (!state.auth.userProfile?.schoolId) {
    issues.push("Select a school.");
  }
  if (!state.director.ensemblesCache.length) {
    issues.push("Create at least one ensemble.");
  }
  const marchTitle = entry.repertoire?.march?.title?.trim();
  if (!marchTitle) {
    issues.push("March title is required.");
  }
  ["selection1", "selection2"].forEach((key, index) => {
    const title = entry.repertoire?.[key]?.title?.trim();
    const grade = entry.repertoire?.[key]?.grade;
    const label = `Selection #${index + 1}`;
    if (!grade) {
      issues.push(`Grade level is required for ${label}.`);
    }
    if (!title) {
      issues.push(`Title is required for ${label}.`);
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

export async function markEntryReady() {
  if (!state.director.entryDraft || !state.director.entryRef) return;
  state.director.entryDraft.repertoire = buildRepertoirePayload();
  state.director.entryDraft.mpaSelections = buildMpaSelectionsPayload(
    state.director.entryDraft.repertoire
  );
  const issues = validateEntryReady(state.director.entryDraft);
  if (issues.length) {
    const message = `Please complete the following before marking Ready:\n- ${issues.join("\n- ")}`;
    return { ok: false, reason: "validation", message, issues };
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
    state.director.dirtySections.clear();
    return { ok: true, status: "ready", message: "Marked ready." };
  } catch (error) {
    console.error("Mark ready failed", error);
    return { ok: false, error };
  }
}

export async function markEntryDraft() {
  if (!state.director.entryDraft || !state.director.entryRef) return;
  try {
    await updateDoc(state.director.entryRef, {
      status: "draft",
      readyAt: null,
      readyByUid: null,
      updatedAt: serverTimestamp(),
    });
    state.director.entryDraft.status = "draft";
    return { ok: true, status: "draft", message: "Marked draft." };
  } catch (error) {
    console.error("Mark draft failed", error);
    return { ok: false, error };
  }
}

export function selectDirectorEnsemble(ensembleId) {
  state.director.selectedEnsembleId = ensembleId;
  return { ok: true, ensembleId };
}

export async function loadDirectorEntry({ onUpdate, onClear } = {}) {
  if (state.subscriptions.directorEntry) {
    state.subscriptions.directorEntry();
    state.subscriptions.directorEntry = null;
  }
  if (!state.auth.userProfile?.schoolId || !state.director.selectedEventId || !state.director.selectedEnsembleId) {
    state.director.entryDraft = null;
    state.director.entryExists = false;
    state.director.entryRef = null;
    onClear?.({
      hint: "Select an ensemble and event to begin.",
      status: "Incomplete",
      readyStatus: "disabled",
    });
    return;
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
      state.director.dirtySections.clear();
    onUpdate?.({
      entry: state.director.entryDraft,
      status: "Incomplete",
      readyStatus: "draft",
      completionState: computeDirectorCompletionState(state.director.entryDraft),
    });
      return;
    }
    state.director.entryExists = true;
    state.director.entryDraft = normalizeEntryData(snapshot.data(), defaults);
    const updatedAt = snapshot.data()?.updatedAt?.toDate?.();
    state.director.dirtySections.clear();
    onUpdate?.({
      entry: state.director.entryDraft,
      status: state.director.entryDraft.status === "ready" ? "Ready" : "Incomplete",
      readyStatus: state.director.entryDraft.status === "ready" ? "ready" : "draft",
      performanceGrade: state.director.entryDraft.performanceGrade || "",
      updatedAt,
      completionState: computeDirectorCompletionState(state.director.entryDraft),
    });
  });
}

export async function handleDeleteEnsemble(ensembleId, ensembleName) {
  if (!state.auth.userProfile?.schoolId) return;
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
    }
    return { ok: true };
  } catch (error) {
    console.error("Delete ensemble failed", error);
    const message =
      error?.message || "Unable to delete ensemble. Check console for details.";
    return { ok: false, message, error };
  }
}

export async function attachDirectorSchool(schoolId) {
  if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) {
    return { ok: false, reason: "not-authorized" };
  }
  if (!schoolId) return { ok: false, reason: "missing-school" };
  const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return { ok: false, reason: "not-provisioned" };
    }
    await updateDoc(userRef, {
      schoolId,
      updatedAt: serverTimestamp(),
    });
    state.auth.userProfile.schoolId = schoolId;
    return { ok: true };
  } catch (error) {
    console.error("Attach school failed", error);
    return { ok: false, error };
  }
}

export async function detachDirectorSchool() {
  if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) {
    return { ok: false, reason: "not-authorized" };
  }
  const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return { ok: false, reason: "not-provisioned" };
    }
    await updateDoc(userRef, {
      schoolId: null,
      updatedAt: serverTimestamp(),
    });
    state.auth.userProfile.schoolId = null;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    return { ok: true };
  } catch (error) {
    console.error("Detach school failed", error);
    return { ok: false, error };
  }
}

export async function createDirectorEnsemble(name) {
  if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) {
    return { ok: false, reason: "not-authorized" };
  }
  if (!state.auth.userProfile.schoolId) {
    return { ok: false, reason: "missing-school" };
  }
  if (!name) {
    return { ok: false, reason: "missing-name" };
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
  state.director.selectedEnsembleId = docRef.id;
  return { ok: true, id: docRef.id };
}

export function setDirectorEvent(nextId) {
  if (!nextId) return { ok: false, reason: "missing-event" };
  state.director.selectedEventId = nextId;
  return { ok: true };
}

export async function saveDirectorProfile({ name, nafmeNumber, expValue }) {
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "director") {
    return { ok: false, reason: "not-authorized" };
  }
  const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
  const userSnap = await getDoc(userRef);
  const rolesPayload = userSnap.exists() && !userSnap.data()?.roles
    ? { roles: { director: true, judge: false, admin: false } }
    : {};
  const payload = {
    displayName: name,
    nafmeMembershipNumber: nafmeNumber,
    nafmeMembershipExp: expValue ? Timestamp.fromDate(new Date(expValue)) : null,
    updatedAt: serverTimestamp(),
  };
  if (userSnap.exists()) {
    await setDoc(userRef, { ...payload, ...rolesPayload }, { merge: true });
  } else {
    await setDoc(userRef, {
      role: "director",
      roles: { director: true, judge: false, admin: false },
      schoolId: state.auth.userProfile?.schoolId || null,
      email: state.auth.userProfile?.email || state.auth.currentUser?.email || "",
      createdAt: serverTimestamp(),
      ...payload,
    });
  }
  state.auth.userProfile.displayName = name;
  state.auth.userProfile.nafmeMembershipNumber = nafmeNumber;
  state.auth.userProfile.nafmeMembershipExp = expValue
    ? Timestamp.fromDate(new Date(expValue))
    : null;
  if (rolesPayload.roles) {
    state.auth.userProfile.roles = rolesPayload.roles;
  }
  return { ok: true, name };
}

export async function uploadDirectorProfileCard(file) {
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "director") {
    return { ok: false, reason: "not-authorized" };
  }
  if (!file) return { ok: false, reason: "missing-file" };
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()
    : "jpg";
  const objectPath = `director_cards/${state.auth.currentUser.uid}/membership-card.${extension}`;
  const storageRef = ref(storage, objectPath);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
  const userSnap = await getDoc(userRef);
  const rolesPayload = userSnap.exists() && !userSnap.data()?.roles
    ? { roles: { director: true, judge: false, admin: false } }
    : {};
  const payload = {
    nafmeCardImageUrl: url,
    nafmeCardImagePath: objectPath,
    updatedAt: serverTimestamp(),
  };
  if (userSnap.exists()) {
    await setDoc(userRef, { ...payload, ...rolesPayload }, { merge: true });
  } else {
    await setDoc(userRef, {
      role: "director",
      roles: { director: true, judge: false, admin: false },
      schoolId: state.auth.userProfile?.schoolId || null,
      email: state.auth.userProfile?.email || state.auth.currentUser?.email || "",
      createdAt: serverTimestamp(),
      ...payload,
    });
  }
  state.auth.userProfile.nafmeCardImageUrl = url;
  state.auth.userProfile.nafmeCardImagePath = objectPath;
  if (rolesPayload.roles) {
    state.auth.userProfile.roles = rolesPayload.roles;
  }
  return { ok: true, url };
}

export function watchDirectorPackets(callback) {
  if (state.subscriptions.directorPackets) state.subscriptions.directorPackets();
  if (state.subscriptions.directorOpenPackets) state.subscriptions.directorOpenPackets();
  if (!state.auth.userProfile || !isDirectorManager()) {
    callback?.({ groups: [], hint: "" });
    return;
  }
  if (!state.auth.userProfile.schoolId) {
    callback?.({ groups: [], hint: "Select a school to continue." });
    return;
  }

  const submissionsQuery = query(
    collection(db, COLLECTIONS.submissions),
    where(FIELDS.submissions.schoolId, "==", state.auth.userProfile.schoolId),
    where(FIELDS.submissions.status, "==", STATUSES.released)
  );

  const packetsQuery = query(
    collection(db, COLLECTIONS.packets),
    where(FIELDS.packets.schoolId, "==", state.auth.userProfile.schoolId),
    where(FIELDS.packets.status, "==", STATUSES.released)
  );

  const merged = { submissions: [], packets: [] };

  state.subscriptions.directorPackets = onSnapshot(submissionsQuery, async (snapshot) => {
    merged.submissions = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    const groups = await buildDirectorPacketGroups(merged);
    callback?.({ groups, hint: "" });
  });

  state.subscriptions.directorOpenPackets = onSnapshot(packetsQuery, async (snapshot) => {
    merged.packets = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    const groups = await buildDirectorPacketGroups(merged);
    callback?.({ groups, hint: "" });
  });
}

async function buildDirectorPacketGroups(merged) {
  const grouped = {};
  merged.submissions.forEach((data) => {
    const key = `${data.eventId}_${data.ensembleId}`;
    if (!grouped[key]) {
      grouped[key] = {
        type: "scheduled",
        eventId: data.eventId,
        ensembleId: data.ensembleId,
        schoolId: data.schoolId,
        submissions: {},
      };
    }
    grouped[key].submissions[data.judgePosition] = data;
  });

  const scheduledGroups = await Promise.all(
    Object.values(grouped).map(async (group) => {
      const [grade, directorName] = await Promise.all([
        fetchEnsembleGrade(group.eventId, group.ensembleId),
        getDirectorNameForSchool(group.schoolId),
      ]);
      const summary = computePacketSummary(grade, group.submissions);
      return {
        ...group,
        directorName,
        grade,
        overall: summary.overall,
      };
    })
  );

  const openGroups = merged.packets.map((packet) => ({
    type: "open",
    packetId: packet.id,
    schoolId: packet.schoolId || "",
    schoolName: packet.schoolName || "",
    ensembleId: packet.ensembleId || "",
    ensembleName: packet.ensembleName || "",
    transcript: packet.transcriptFull || packet.transcript || "",
    captionScoreTotal: packet.captionScoreTotal,
    computedFinalRatingLabel: packet.computedFinalRatingLabel || "N/A",
    latestAudioUrl: packet.latestAudioUrl || "",
    releasedAt: packet.releasedAt || null,
  }));

  return [...openGroups, ...scheduledGroups];
}

export function watchDirectorSchool(callback) {
  if (state.subscriptions.directorSchool) state.subscriptions.directorSchool();
  if (!state.auth.userProfile || !isDirectorManager()) return;
  if (!state.auth.userProfile.schoolId) {
    callback?.("No school attached");
    return;
  }
  const schoolRef = doc(db, COLLECTIONS.schools, state.auth.userProfile.schoolId);
  state.subscriptions.directorSchool = onSnapshot(schoolRef, (snapshot) => {
    const name = snapshot.exists() ? snapshot.data().name || snapshot.id : "Unknown school";
    callback?.(name);
  });
}

export function watchDirectorSchoolDirectors(callback) {
  if (state.subscriptions.directorSchoolDirectors) {
    state.subscriptions.directorSchoolDirectors();
  }
  if (!state.auth.userProfile || !isDirectorManager()) return;
  const schoolId = state.auth.userProfile.schoolId;
  if (!schoolId) {
    callback?.([]);
    return;
  }
  const directorQuery = query(
    collection(db, COLLECTIONS.users),
    where(FIELDS.users.role, "==", "director"),
    where(FIELDS.users.schoolId, "==", schoolId)
  );
  state.subscriptions.directorSchoolDirectors = onSnapshot(
    directorQuery,
    (snapshot) => {
      const directors = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        return {
          id: docSnap.id,
          displayName: data.displayName || "",
          email: data.email || "",
        };
      });
      directors.sort((a, b) => {
        const aName = (a.displayName || a.email || "").toLowerCase();
        const bName = (b.displayName || b.email || "").toLowerCase();
        return aName.localeCompare(bName);
      });
      callback?.(directors);
    },
    (error) => {
      console.error("watchDirectorSchoolDirectors failed", error);
      callback?.([]);
    }
  );
}

export function watchDirectorEnsembles(callback) {
  if (state.subscriptions.directorEnsembles) state.subscriptions.directorEnsembles();
  if (!state.auth.userProfile || !isDirectorManager()) return;
  if (!state.auth.userProfile.schoolId) {
    state.director.ensemblesCache = [];
    callback?.([]);
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
    }
    callback?.(ensembles);
  });
}
