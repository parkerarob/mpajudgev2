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
import { computePacketSummary } from "./judge-shared.js";

export function isDirectorManager() {
  return state.auth.userProfile?.role === "director" || state.auth.userProfile?.role === "admin";
}

export function getDirectorSchoolId() {
  if (state.auth.userProfile?.role === "admin") {
    return state.director.adminViewSchoolId || null;
  }
  return state.auth.userProfile?.schoolId || null;
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
      repertoireRuleMode: "standard",
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
    adminDuties: {
      signatureFormReceived: false,
      feeReceived: false,
      payment: {
        method: "",
        amount: null,
        checkNumber: "",
      },
      adminNote: "",
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
  base.repertoire.repertoireRuleMode =
    data?.repertoire?.repertoireRuleMode === "masterwork" ? "masterwork" : "standard";
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
  base.adminDuties = {
    ...defaults.adminDuties,
    ...(data?.adminDuties || {}),
  };
  base.adminDuties.payment = {
    ...(defaults.adminDuties?.payment || {}),
    ...(data?.adminDuties?.payment || {}),
  };
  base.adminDuties.signatureFormReceived = Boolean(base.adminDuties.signatureFormReceived);
  base.adminDuties.feeReceived = Boolean(base.adminDuties.feeReceived);
  base.adminDuties.payment.method =
    base.adminDuties.payment.method === "check" || base.adminDuties.payment.method === "cash"
      ? base.adminDuties.payment.method
      : "";
  const parsedAmount = Number(base.adminDuties.payment.amount);
  base.adminDuties.payment.amount =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  base.adminDuties.payment.checkNumber = String(base.adminDuties.payment.checkNumber || "").trim();
  base.adminDuties.adminNote = String(base.adminDuties.adminNote || "");
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

async function getCachedPacketGrade(eventId, ensembleId) {
  const key = `${eventId || ""}_${ensembleId || ""}`;
  if (state.director.packetGradeCache.has(key)) {
    return state.director.packetGradeCache.get(key);
  }
  const grade = await fetchEnsembleGrade(eventId, ensembleId);
  state.director.packetGradeCache.set(key, grade || "");
  return grade || "";
}

export async function ensureEntryDocExists() {
  if (!state.director.entryRef || !state.director.entryDraft) return false;
  if (state.director.entryExists) return true;
  const base = buildDefaultEntry({
    eventId: state.director.selectedEventId,
    schoolId: getDirectorSchoolId() || "",
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
          status: data.status || "",
          tags: Array.isArray(data.tags) ? data.tags : [],
          isMasterwork: Boolean(data.isMasterwork),
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
  const repertoireRuleMode =
    state.director.entryDraft.repertoire?.repertoireRuleMode === "masterwork"
      ? "masterwork"
      : "standard";
  const marchTitle = state.director.entryDraft.repertoire?.march?.title?.trim();
  const selection1Grade = state.director.entryDraft.repertoire?.selection1?.grade;
  const selection2Grade = state.director.entryDraft.repertoire?.selection2?.grade;
  const selection1Title = state.director.entryDraft.repertoire?.selection1?.title?.trim();
  const selection2Title = state.director.entryDraft.repertoire?.selection2?.title?.trim();
  const selection1Level = romanToLevel(selection1Grade);
  const selection2Level = romanToLevel(selection2Grade);
  let derived = null;
  if (repertoireRuleMode === "masterwork") {
    const isMasterworkPiece = (selection) => {
      const id = selection?.pieceId || null;
      const grade = normalizeGrade(selection?.grade);
      if (!id || !grade) return false;
      const options = state.director.mpaCacheByGrade.get(grade) || [];
      const match = options.find((item) => item.id === id);
      if (!match) return false;
      if (match.isMasterwork) return true;
      const haystack = `${match.specialInstructions || ""} ${match.status || ""} ${(match.tags || []).join(" ")}`.toLowerCase();
      return haystack.includes("masterwork") || haystack.includes("mw*");
    };
    const selection1 = state.director.entryDraft.repertoire?.selection1 || {};
    const hasSelection1 = Boolean(selection1Title && selection1Grade);
    if (!hasSelection1) {
      return {
        ok: false,
        reason: "validation",
        message: "Masterwork Exception requires Selection #1.",
      };
    }
    if (!isMasterworkPiece(selection1)) {
      return {
        ok: false,
        reason: "validation",
        message: "Masterwork Exception requires Selection #1 to be a Masterwork.",
      };
    }
    derived = { ok: true, value: "VI" };
  } else {
    derived = derivePerformanceGrade(selection1Level, selection2Level);
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
  const repertoireRuleMode = entry?.repertoire?.repertoireRuleMode === "masterwork" ? "masterwork" : "standard";
  const marchTitle = entry?.repertoire?.march?.title?.trim();
  const selection1Title = entry?.repertoire?.selection1?.title?.trim();
  const selection2Title = entry?.repertoire?.selection2?.title?.trim();
  const selection1Grade = entry?.repertoire?.selection1?.grade;
  const selection2Grade = entry?.repertoire?.selection2?.grade;
  const standardRepertoireComplete =
    Boolean(marchTitle) &&
    Boolean(selection1Title) &&
    Boolean(selection2Title) &&
    Boolean(selection1Grade) &&
    Boolean(selection2Grade);
  const hasSelection1 = Boolean(selection1Title) && Boolean(selection1Grade);
  const hasSelection2 = Boolean(selection2Title) && Boolean(selection2Grade);
  let repertoireComplete = standardRepertoireComplete;
  if (repertoireRuleMode === "masterwork") {
    const isMasterworkBySelection = (selection) => {
      const id = selection?.pieceId || null;
      const grade = normalizeGrade(selection?.grade);
      if (!id || !grade) return false;
      const options = state.director.mpaCacheByGrade.get(grade) || [];
      const match = options.find((item) => item.id === id);
      if (!match) return false;
      if (match.isMasterwork) return true;
      const haystack = `${match.specialInstructions || ""} ${match.status || ""} ${(match.tags || []).join(" ")}`.toLowerCase();
      return haystack.includes("masterwork") || haystack.includes("mw*");
    };
    const hasMasterworkSelection1 =
      hasSelection1 && isMasterworkBySelection(entry?.repertoire?.selection1);
    repertoireComplete = Boolean(marchTitle) && hasSelection1 && hasMasterworkSelection1;
  }
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

export async function loadDirectorSchoolLunchTotal({ eventId, schoolId } = {}) {
  if (!eventId || !schoolId) return { total: 0, mealCount: 0 };
  const ensembles = Array.isArray(state.director.ensemblesCache)
    ? state.director.ensemblesCache
    : [];
  if (!ensembles.length) return { total: 0, mealCount: 0 };
  const ensembleIds = ensembles.map((ensemble) => ensemble.id).filter(Boolean).sort();
  const cacheKey = `${eventId}:${schoolId}:${ensembleIds.join(",")}`;
  const cached = state.director.lunchTotalsCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < 5000) {
    return cached.value;
  }
  if (state.director.lunchTotalsInFlight.has(cacheKey)) {
    return state.director.lunchTotalsInFlight.get(cacheKey);
  }

  const loader = (async () => {
    const docs = await Promise.all(
      ensembleIds.map((ensembleId) =>
        getDoc(doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId))
      )
    );

    let mealCount = 0;
    docs.forEach((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const lunch = data.lunchOrder || {};
      mealCount += normalizeNumber(lunch.pepperoniQty) + normalizeNumber(lunch.cheeseQty);
    });

    const value = {
      mealCount,
      total: mealCount * 8,
    };
    state.director.lunchTotalsCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  })();
  state.director.lunchTotalsInFlight.set(cacheKey, loader);
  try {
    return await loader;
  } finally {
    state.director.lunchTotalsInFlight.delete(cacheKey);
  }
}

export function invalidateDirectorSchoolLunchTotalCache({ eventId, schoolId } = {}) {
  const eventPrefix = eventId ? `${eventId}:` : "";
  for (const key of state.director.lunchTotalsCache.keys()) {
    if (eventId && !key.startsWith(eventPrefix)) continue;
    if (schoolId && !key.includes(`:${schoolId}:`)) continue;
    state.director.lunchTotalsCache.delete(key);
  }
  for (const key of state.director.lunchTotalsInFlight.keys()) {
    if (eventId && !key.startsWith(eventPrefix)) continue;
    if (schoolId && !key.includes(`:${schoolId}:`)) continue;
    state.director.lunchTotalsInFlight.delete(key);
  }
}

export function validateEntryReady(entry) {
  const issues = [];
  if (!getDirectorSchoolId()) {
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

async function loadLatestDirectorEntryForEnsemble({
  schoolId,
  ensembleId,
  excludeEventId,
} = {}) {
  if (!schoolId || !ensembleId) return null;
  const events = Array.isArray(state.event.list) ? [...state.event.list] : [];
  events.sort((a, b) => {
    const aTime = a?.startAt?.toMillis ? a.startAt.toMillis() : 0;
    const bTime = b?.startAt?.toMillis ? b.startAt.toMillis() : 0;
    return bTime - aTime;
  });
  for (const event of events) {
    if (!event?.id || event.id === excludeEventId) continue;
    try {
      const ref = doc(db, COLLECTIONS.events, event.id, COLLECTIONS.entries, ensembleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const data = snap.data() || {};
      if ((data.schoolId || schoolId) !== schoolId) continue;
      return { eventId: event.id, data };
    } catch (error) {
      console.warn("Failed loading prior director entry for carry-forward", error);
    }
  }
  return null;
}

export async function loadDirectorEntry({ onUpdate, onClear } = {}) {
  if (state.subscriptions.directorEntry) {
    state.subscriptions.directorEntry();
    state.subscriptions.directorEntry = null;
  }
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId || !state.director.selectedEventId || !state.director.selectedEnsembleId) {
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

  const loadEventId = state.director.selectedEventId;
  const loadEnsembleId = state.director.selectedEnsembleId;
  const loadSchoolId = directorSchoolId;

  state.subscriptions.directorEntry = onSnapshot(state.director.entryRef, async (snapshot) => {
    const defaults = buildDefaultEntry({
      eventId: loadEventId,
      schoolId: loadSchoolId,
      ensembleId: loadEnsembleId,
      createdByUid: state.auth.currentUser?.uid || "",
    });
    if (hasDirectorUnsavedChanges()) {
      return;
    }
    if (!snapshot.exists()) {
      const prior = await loadLatestDirectorEntryForEnsemble({
        schoolId: loadSchoolId,
        ensembleId: loadEnsembleId,
        excludeEventId: loadEventId,
      });
      if (
        state.director.selectedEventId !== loadEventId ||
        state.director.selectedEnsembleId !== loadEnsembleId ||
        getDirectorSchoolId() !== loadSchoolId ||
        hasDirectorUnsavedChanges()
      ) {
        return;
      }
      state.director.entryDraft = prior
        ? normalizeEntryData(prior.data, defaults)
        : defaults;
      state.director.entryExists = false;
      state.director.dirtySections.clear();
      const carriedReady = state.director.entryDraft.status === "ready";
      onUpdate?.({
        entry: state.director.entryDraft,
        status: carriedReady ? "Ready" : "Incomplete",
        readyStatus: carriedReady ? "ready" : "draft",
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
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId) return;
  try {
    const deleteEnsemble = httpsCallable(functions, "deleteEnsemble");
    await deleteEnsemble({
      schoolId: directorSchoolId,
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
  if (state.auth.userProfile.role === "admin") {
    state.director.adminViewSchoolId = schoolId;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    state.director.entryExists = false;
    return { ok: true, mode: "admin-view" };
  }
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
  if (state.auth.userProfile.role === "admin") {
    state.director.adminViewSchoolId = null;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    state.director.entryExists = false;
    return { ok: true, mode: "admin-view" };
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
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId) {
    return { ok: false, reason: "missing-school" };
  }
  if (!name) {
    return { ok: false, reason: "missing-name" };
  }
  const ensemblesRef = collection(
    db,
    COLLECTIONS.schools,
    directorSchoolId,
    "ensembles"
  );
  const docRef = await addDoc(ensemblesRef, {
    name,
    schoolId: directorSchoolId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: state.auth.currentUser.uid,
  });
  state.director.selectedEnsembleId = docRef.id;
  return { ok: true, id: docRef.id };
}

export async function renameDirectorEnsemble(ensembleId, name) {
  if (!state.auth.currentUser || !state.auth.userProfile || !isDirectorManager()) {
    return { ok: false, reason: "not-authorized" };
  }
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId) {
    return { ok: false, reason: "missing-school" };
  }
  if (!ensembleId) {
    return { ok: false, reason: "missing-ensemble" };
  }
  if (!name) {
    return { ok: false, reason: "missing-name" };
  }
  try {
    const renameEnsemble = httpsCallable(functions, "renameEnsemble");
    const response = await renameEnsemble({ schoolId: directorSchoolId, ensembleId, name });
    return {
      ok: true,
      ensembleId,
      name,
      updatedPacketCount: Number(response?.data?.updatedPacketCount || 0),
    };
  } catch (error) {
    console.error("Rename ensemble failed", error);
    return { ok: false, error, message: error?.message || "Unable to rename ensemble." };
  }
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
  state.director.packetGradeCache.clear();
  state.director.packetWatchVersion += 1;
  const watchVersion = state.director.packetWatchVersion;
  if (!state.auth.userProfile || !isDirectorManager()) {
    callback?.({ groups: [], hint: "" });
    return;
  }
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId) {
    callback?.({ groups: [], hint: "Select a school to continue." });
    return;
  }

  const submissionsQuery = query(
    collection(db, COLLECTIONS.submissions),
    where(FIELDS.submissions.schoolId, "==", directorSchoolId),
    where(FIELDS.submissions.status, "==", STATUSES.released)
  );

  const packetsQuery = query(
    collection(db, COLLECTIONS.packets),
    where(FIELDS.packets.schoolId, "==", directorSchoolId),
    where(FIELDS.packets.status, "==", STATUSES.released)
  );

  const merged = { submissions: [], packets: [] };
  let buildVersion = 0;
  let lastSignature = "";
  let lastGroups = [];

  const buildSignature = () => {
    const submissionSig = merged.submissions
      .map((item) => [
        item.id || "",
        item.status || "",
        item.locked ? 1 : 0,
        item.releasedAt?.seconds || 0,
        item.releasedAt?.nanoseconds || 0,
        item.updatedAt?.seconds || 0,
        item.updatedAt?.nanoseconds || 0,
      ].join(":"))
      .sort()
      .join("|");
    const packetSig = merged.packets
      .map((item) => [
        item.id || "",
        item.status || "",
        item.locked ? 1 : 0,
        item.judgePosition || "",
        item.assignmentEventId || "",
        item.schoolId || "",
        item.ensembleId || "",
        item.updatedAt?.seconds || 0,
        item.updatedAt?.nanoseconds || 0,
        item.releasedAt?.seconds || 0,
        item.releasedAt?.nanoseconds || 0,
      ].join(":"))
      .sort()
      .join("|");
    return `s:${submissionSig}||p:${packetSig}`;
  };

  const emitMergedGroups = async () => {
    const currentBuildVersion = ++buildVersion;
    const signature = buildSignature();
    if (signature === lastSignature) {
      callback?.({ groups: lastGroups, hint: "" });
      return;
    }
    const groups = await buildDirectorPacketGroups(merged);
    // Ignore stale async completions after a newer snapshot or watcher restart.
    if (watchVersion !== state.director.packetWatchVersion) return;
    if (currentBuildVersion !== buildVersion) return;
    lastSignature = signature;
    lastGroups = groups;
    callback?.({ groups, hint: "" });
  };

  state.subscriptions.directorPackets = onSnapshot(
    submissionsQuery,
    async (snapshot) => {
      merged.submissions = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      await emitMergedGroups();
    },
    (error) => {
      console.error("watchDirectorPackets submissions failed", error);
      if (watchVersion !== state.director.packetWatchVersion) return;
      callback?.({ groups: [], hint: "Unable to load released packets right now." });
    }
  );

  state.subscriptions.directorOpenPackets = onSnapshot(
    packetsQuery,
    async (snapshot) => {
      merged.packets = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      await emitMergedGroups();
    },
    (error) => {
      console.error("watchDirectorPackets open packets failed", error);
      if (watchVersion !== state.director.packetWatchVersion) return;
      callback?.({ groups: [], hint: "Unable to load released packets right now." });
    }
  );
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
        getCachedPacketGrade(group.eventId, group.ensembleId),
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
  const openPacketSets = new Map();
  const standaloneOpenGroups = [];

  merged.packets.forEach((packet) => {
    const judgePosition = packet.judgePosition || "";
    const assignmentEventId = packet.assignmentEventId || "";
    const canAssemble =
      Boolean(packet.schoolId) &&
      Boolean(packet.ensembleId) &&
      Boolean(judgePosition) &&
      Boolean(assignmentEventId);

    if (!canAssemble) {
      standaloneOpenGroups.push({
        type: "open",
        packetId: packet.id,
        schoolId: packet.schoolId || "",
        schoolName: packet.schoolName || "",
        ensembleId: packet.ensembleId || "",
        ensembleName: packet.ensembleName || "",
        status: packet.status || "released",
        locked: Boolean(packet.locked),
        judgeName: packet.createdByJudgeName || "",
        judgeEmail: packet.createdByJudgeEmail || "",
        formType: packet.formType || "stage",
        captions: packet.captions || {},
        captionScoreTotal: packet.captionScoreTotal,
        computedFinalRatingLabel: packet.computedFinalRatingLabel || "N/A",
        computedFinalRatingJudge: packet.computedFinalRatingJudge ?? null,
        latestAudioUrl: packet.latestAudioUrl || "",
        judgePosition,
        assignmentEventId,
        releasedAt: packet.releasedAt || null,
      });
      return;
    }

    const key = `${assignmentEventId}_${packet.ensembleId}`;
    if (!openPacketSets.has(key)) {
      openPacketSets.set(key, {
        type: "open-assembled",
        eventId: assignmentEventId,
        ensembleId: packet.ensembleId || "",
        ensembleName: packet.ensembleName || packet.ensembleId || "",
        schoolId: packet.schoolId || "",
        schoolName: packet.schoolName || packet.schoolId || "",
        submissions: {},
        sourcePackets: [],
        conflicts: [],
      });
    }
    const group = openPacketSets.get(key);
    const syntheticSubmission = {
      id: packet.id,
      status: packet.status || "released",
      locked: Boolean(packet.locked),
      judgePosition,
      judgeName: packet.createdByJudgeName || "",
      judgeEmail: packet.createdByJudgeEmail || "",
      formType: packet.formType || "stage",
      captions: packet.captions || {},
      captionScoreTotal: packet.captionScoreTotal ?? null,
      computedFinalRatingJudge: packet.computedFinalRatingJudge ?? null,
      computedFinalRatingLabel: packet.computedFinalRatingLabel || "N/A",
      audioUrl: packet.latestAudioUrl || "",
      transcript: "",
      transcriptFull: "",
    };
    if (group.submissions[judgePosition]) {
      group.conflicts.push(judgePosition);
    } else {
      group.submissions[judgePosition] = syntheticSubmission;
    }
    group.sourcePackets.push({
      id: packet.id,
      judgePosition,
      judgeName: syntheticSubmission.judgeName,
      judgeEmail: syntheticSubmission.judgeEmail,
    });
  });

  const assembledOpenGroups = await Promise.all(
    Array.from(openPacketSets.values()).map(async (group) => {
      const [grade, directorName] = await Promise.all([
        group.eventId ? getCachedPacketGrade(group.eventId, group.ensembleId) : Promise.resolve(""),
        getDirectorNameForSchool(group.schoolId),
      ]);
      const summary = computePacketSummary(grade, group.submissions);
      const overall = group.conflicts.length ? { label: "N/A", value: null } : summary.overall;
      return {
        ...group,
        grade,
        directorName,
        overall,
        hasConflicts: group.conflicts.length > 0,
      };
    })
  );

  return [...standaloneOpenGroups, ...assembledOpenGroups, ...scheduledGroups];
}

export function watchDirectorSchool(callback) {
  if (state.subscriptions.directorSchool) state.subscriptions.directorSchool();
  if (!state.auth.userProfile || !isDirectorManager()) return;
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId) {
    callback?.("No school attached");
    return;
  }
  const schoolRef = doc(db, COLLECTIONS.schools, directorSchoolId);
  state.subscriptions.directorSchool = onSnapshot(
    schoolRef,
    (snapshot) => {
      const name = snapshot.exists() ? snapshot.data().name || snapshot.id : "Unknown school";
      callback?.(name);
    },
    (error) => {
      console.error("watchDirectorSchool failed", error);
      callback?.("Unable to load school");
    }
  );
}

export function watchDirectorSchoolDirectors(callback) {
  if (state.subscriptions.directorSchoolDirectors) {
    state.subscriptions.directorSchoolDirectors();
  }
  if (!state.auth.userProfile || !isDirectorManager()) return;
  const schoolId = getDirectorSchoolId();
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
  const directorSchoolId = getDirectorSchoolId();
  if (!directorSchoolId) {
    state.director.ensemblesCache = [];
    state.director.selectedEnsembleId = null;
    invalidateDirectorSchoolLunchTotalCache();
    callback?.([]);
    return;
  }
  const ensemblesRef = collection(
    db,
    COLLECTIONS.schools,
    directorSchoolId,
    "ensembles"
  );
  const ensemblesQuery = query(ensemblesRef, orderBy("name"));
  state.subscriptions.directorEnsembles = onSnapshot(
    ensemblesQuery,
    (snapshot) => {
      const ensembles = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      state.director.ensemblesCache = ensembles;
      invalidateDirectorSchoolLunchTotalCache({
        eventId: state.director.selectedEventId || state.event.active?.id || null,
        schoolId: directorSchoolId,
      });
      const exists = ensembles.some(
        (ensemble) => ensemble.id === state.director.selectedEnsembleId
      );
      if (!ensembles.length) {
        state.director.selectedEnsembleId = null;
      } else if (!state.director.selectedEnsembleId || !exists) {
        state.director.selectedEnsembleId = ensembles[0].id;
      }
      callback?.(ensembles);
    },
    (error) => {
      console.error("watchDirectorEnsembles failed", error);
      state.director.ensemblesCache = [];
      state.director.selectedEnsembleId = null;
      invalidateDirectorSchoolLunchTotalCache({
        eventId: state.director.selectedEventId || state.event.active?.id || null,
        schoolId: directorSchoolId,
      });
      callback?.([]);
    }
  );
}
