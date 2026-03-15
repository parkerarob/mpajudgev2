import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
} from "./firestore.js";
import { db, functions, storage } from "../firebase.js";
import { normalizeCaptions } from "./utils.js";
import {
  CAPTION_TEMPLATES,
  COLLECTIONS,
  FIELDS,
  FORM_TYPES,
  GRADE_VALUES,
  STATUSES,
  state,
} from "../state.js";

const OPEN_RECORDING_MAX_SEGMENT_MS = 6 * 60 * 1000;
const OPEN_RECORDING_RESTART_COOLDOWN_MS = 2500;
const OPEN_AUTO_TRANSCRIBE_SETTLE_MS = 5000;
const OPEN_AUTO_TRANSCRIBE_MAX_RETRIES = 2;
const OPEN_AUTO_TRANSCRIBE_RETRY_BASE_MS = 3000;
const OPEN_PREFS_KEY = "judgeOpenPrefs";
const OPEN_ENSEMBLE_INDEX_CACHE_TTL_MS = 60 * 1000;
const OPEN_RECORDING_AUDIO_BITS_PER_SECOND = 96000;
const OPEN_AUDIO_CONSTRAINTS = {
  audio: {
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};
const OPEN_MIC_LABEL_REWRITES = [
  {
    pattern: /\bAK-2\b/i,
    label: "Aokeo Judge Microphone",
  },
];

let openEnsembleIndexCache = {
  key: "",
  cachedAt: 0,
  items: [],
  inFlight: null,
};

let judgeOpenAutoTranscriptionHooks = {
  onTranscriptUpdated: null,
  onStatus: null,
};

function normalizePacketAudioSegments(audioSegments = []) {
  if (!Array.isArray(audioSegments)) return [];
  return audioSegments
    .map((segment, index) => {
      const audioUrl = String(segment?.audioUrl || "").trim();
      const audioPath = String(segment?.audioPath || "").trim();
      if (!audioUrl && !audioPath) return null;
      const durationSec = Number(segment?.durationSec || 0);
      const sortOrder = Number(segment?.sortOrder ?? index);
      return {
        sessionId: String(segment?.sessionId || segment?.id || `segment_${index + 1}`),
        label: String(segment?.label || `Part ${index + 1}`),
        audioUrl,
        audioPath,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function upsertPacketAudioSegment(segment) {
  const normalized = normalizePacketAudioSegments([
    ...(Array.isArray(state.judgeOpen.currentPacket?.audioSegments)
      ? state.judgeOpen.currentPacket.audioSegments
      : []),
    segment,
  ]);
  const deduped = [];
  const seen = new Set();
  normalized.forEach((item) => {
    const key = item.sessionId || item.label;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  if (state.judgeOpen.currentPacket) {
    state.judgeOpen.currentPacket = {
      ...state.judgeOpen.currentPacket,
      audioSegments: deduped,
    };
  }
  return deduped;
}

function isOpenDebugEnabled() {
  try {
    return window.localStorage?.getItem("mpa.judgeOpenDebug") === "1";
  } catch {
    return false;
  }
}

function debugOpenLog(...args) {
  if (!isOpenDebugEnabled()) return;
  console.log("[judge-open]", ...args);
}

function setAutoTranscriptStatus(text = "") {
  state.judgeOpen.autoTranscriptStatusText = String(text || "");
  judgeOpenAutoTranscriptionHooks.onStatus?.(state.judgeOpen.autoTranscriptStatusText);
}

function clearAutoTranscriptionRetryTimer(sessionId) {
  const timerId = state.judgeOpen.autoTranscribeRetryTimers[sessionId];
  if (timerId != null) {
    window.clearTimeout(timerId);
    delete state.judgeOpen.autoTranscribeRetryTimers[sessionId];
  }
}

function clearAutoTranscriptionRuntimeState() {
  Object.keys(state.judgeOpen.autoTranscribeRetryTimers || {}).forEach((sessionId) => {
    clearAutoTranscriptionRetryTimer(sessionId);
  });
  state.judgeOpen.autoTranscribeInFlight = {};
  state.judgeOpen.autoTranscribeRetryCount = {};
  state.judgeOpen.autoTranscribePendingSince = {};
  state.judgeOpen.autoStopTranscribeInFlight = false;
  setAutoTranscriptStatus("");
}

function sessionStartedAtMs(session) {
  if (session?.startedAt?.toMillis) return session.startedAt.toMillis();
  if (session?.createdAt?.toMillis) return session.createdAt.toMillis();
  return 0;
}

function isSessionReadyForAutoTranscription(session) {
  if (!session?.id) return false;
  if (String(session.status || "") !== "completed") return false;
  if (!session.masterAudioUrl) return false;
  if (session.needsUpload) return false;
  const transcriptStatus = String(session.transcriptStatus || "").toLowerCase();
  if (transcriptStatus === "complete" || transcriptStatus === "running") return false;
  return true;
}

function buildStitchedTranscriptFromSessions(sessions = []) {
  const ordered = [...sessions].sort((a, b) => sessionStartedAtMs(a) - sessionStartedAtMs(b));
  const parts = ordered
    .map((session) => String(session.transcript || "").trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

function patchLocalSessionState(sessionId, patch = {}) {
  const sessions = Array.isArray(state.judgeOpen.sessions) ? state.judgeOpen.sessions : [];
  const index = sessions.findIndex((session) => session?.id === sessionId);
  if (index < 0) return;
  state.judgeOpen.sessions[index] = {
    ...sessions[index],
    ...patch,
  };
}

async function syncOpenTranscriptFromSessionState() {
  const transcript = buildStitchedTranscriptFromSessions(state.judgeOpen.sessions || []);
  state.judgeOpen.transcriptText = transcript;
  judgeOpenAutoTranscriptionHooks.onTranscriptUpdated?.(transcript, { source: "auto-segment" });
  if (!state.judgeOpen.currentPacketId) return;
  const sessions = state.judgeOpen.sessions || [];
  const completedSessions = sessions.filter((session) => String(session.status || "") === "completed");
  const completeCount = completedSessions.filter(
    (session) => String(session.transcriptStatus || "").toLowerCase() === "complete"
  ).length;
  const failedCount = completedSessions.filter(
    (session) => String(session.transcriptStatus || "").toLowerCase() === "failed"
  ).length;
  const hasCompleted = completedSessions.length > 0;
  const transcriptStatus = !hasCompleted
    ? "idle"
    : failedCount > 0 && completeCount === 0
      ? "failed"
      : failedCount > 0
        ? "partial"
        : completeCount >= completedSessions.length
          ? "complete"
          : "running";
  await updateOpenPacketDraft({
    [FIELDS.packets.transcriptFull]: transcript,
    [FIELDS.packets.transcript]: transcript,
    [FIELDS.packets.transcriptStatus]: transcriptStatus,
    [FIELDS.packets.transcriptError]: failedCount > 0 ? "One or more recording parts failed." : "",
  });
}

function getSessionSigValue(session, key) {
  const value = session?.[key];
  if (value?.toMillis) return value.toMillis();
  return value ?? "";
}

function buildOpenSessionsSignature(sessions = []) {
  return sessions
    .map((session) => {
      const started = getSessionSigValue(session, "startedAt");
      const updated = getSessionSigValue(session, "updatedAt");
      const completed = getSessionSigValue(session, "completedAt");
      const ended = getSessionSigValue(session, "endedAt");
      return [
        session.id || "",
        session.status || "",
        session.transcriptStatus || "",
        session.masterAudioUrl ? "1" : "0",
        session.needsUpload ? "1" : "0",
        Number(session.durationSec || 0),
        Number(session.chunkCount || 0),
        started,
        updated,
        completed,
        ended,
      ].join(":");
    })
    .join("|");
}

function flushOpenSessionsRender(callback) {
  if (state.judgeOpen.openSessionsRafId != null) {
    window.cancelAnimationFrame(state.judgeOpen.openSessionsRafId);
    state.judgeOpen.openSessionsRafId = null;
  }
  const pending = Array.isArray(state.judgeOpen.openSessionsPendingRender)
    ? state.judgeOpen.openSessionsPendingRender
    : [];
  state.judgeOpen.openSessionsPendingRender = null;
  callback?.(pending);
}

function scheduleOpenSessionsRender(callback) {
  const pending = Array.isArray(state.judgeOpen.openSessionsPendingRender)
    ? state.judgeOpen.openSessionsPendingRender
    : [];
  const nextSig = buildOpenSessionsSignature(pending);
  if (nextSig === state.judgeOpen.openSessionsLastSig) return;
  if (state.judgeOpen.openSessionsRafId != null) return;
  state.judgeOpen.openSessionsRafId = window.requestAnimationFrame(() => {
    state.judgeOpen.openSessionsRafId = null;
    const sessionsToRender = Array.isArray(state.judgeOpen.openSessionsPendingRender)
      ? state.judgeOpen.openSessionsPendingRender
      : [];
    state.judgeOpen.openSessionsPendingRender = null;
    const renderSig = buildOpenSessionsSignature(sessionsToRender);
    if (renderSig === state.judgeOpen.openSessionsLastSig) return;
    state.judgeOpen.openSessionsLastSig = renderSig;
    state.judgeOpen.openSessionsRenderCount += 1;
    debugOpenLog("sessions render", {
      snapshots: state.judgeOpen.openSessionsSnapshotCount,
      renders: state.judgeOpen.openSessionsRenderCount,
      count: sessionsToRender.length,
    });
    callback?.(sessionsToRender);
  });
}

function buildPacketDisplay(packet) {
  const school = packet.schoolName || "Unknown school";
  const ensemble = packet.ensembleName || "Unknown ensemble";
  const status = packet.status || "draft";
  const mode = packet.mode === "official" ? "official" : "practice";
  return `${school} - ${ensemble} - ${mode} - ${status}`;
}

function normalizeDirectorEntrySnapshot(data, { eventId, eventName } = {}) {
  if (!data || typeof data !== "object") return null;
  const repertoire = data.repertoire || {};
  const instrumentation = data.instrumentation || {};
  const snapshot = {
    source: {
      eventId: eventId || "",
      eventName: eventName || "",
    },
    performanceGrade: String(data.performanceGrade || ""),
    performanceGradeFlex: Boolean(data.performanceGradeFlex),
    repertoire: {
      repertoireRuleMode:
        repertoire.repertoireRuleMode === "masterwork" ? "masterwork" : "standard",
      march: {
        title: String(repertoire.march?.title || ""),
        composer: String(repertoire.march?.composer || ""),
      },
      selection1: {
        grade: String(repertoire.selection1?.grade || ""),
        title: String(repertoire.selection1?.title || ""),
        composer: String(repertoire.selection1?.composer || ""),
        pieceId: repertoire.selection1?.pieceId || null,
      },
      selection2: {
        grade: String(repertoire.selection2?.grade || ""),
        title: String(repertoire.selection2?.title || ""),
        composer: String(repertoire.selection2?.composer || ""),
        pieceId: repertoire.selection2?.pieceId || null,
      },
    },
    instrumentation: {
      totalPercussion: Number(instrumentation.totalPercussion || 0),
      standardCounts:
        instrumentation.standardCounts && typeof instrumentation.standardCounts === "object"
          ? { ...instrumentation.standardCounts }
          : {},
      nonStandard: Array.isArray(instrumentation.nonStandard)
        ? instrumentation.nonStandard.map((row) => ({
            instrumentName: String(row?.instrumentName || ""),
            count: Number(row?.count || 0),
          }))
        : [],
      otherInstrumentationNotes: String(instrumentation.otherInstrumentationNotes || ""),
    },
    entryStatus: String(data.status || ""),
    updatedAt: data.updatedAt || null,
  };
  return snapshot;
}

export function resetJudgeOpenState() {
  state.judgeOpen.currentPacketId = null;
  state.judgeOpen.currentPacket = null;
  state.judgeOpen.sessions = [];
  state.judgeOpen.mediaRecorder = null;
  state.judgeOpen.recordingChunks = [];
  state.judgeOpen.pendingUploads = 0;
  state.judgeOpen.activeSessionId = null;
  state.judgeOpen.recordingKeepAlive = false;
  state.judgeOpen.recordingAutoRolloverReason = "";
  clearOpenRolloverTimer();
  state.judgeOpen.recordingCooldownUntil = 0;
  state.judgeOpen.availableMicrophones = [];
  state.judgeOpen.selectedMicDeviceId = "";
  state.judgeOpen.selectedMicLabel = "";
  state.judgeOpen.transcriptText = "";
  state.judgeOpen.captions = {};
  state.judgeOpen.retryUploads = {};
  state.judgeOpen.selectedExisting = null;
  state.judgeOpen.restoreAttempted = false;
  state.judgeOpen.levelMeter = null;
  state.judgeOpen.activeEventAssignment = null;
  state.judgeOpen.micTrackSettings = null;
  state.judgeOpen.directorEntryReference = null;
  state.judgeOpen.directorEntryReferenceStatus = "idle";
  state.judgeOpen.directorEntryReferenceMessage = "";
  state.judgeOpen.directorEntryReferenceLoadVersion = 0;
  state.judgeOpen.packetSelectionInFlight = false;
  state.judgeOpen.pendingOpenPacketId = "";
  state.judgeOpen.packetSelectionToken = 0;
  state.judgeOpen.packetMutationInFlight = false;
  state.judgeOpen.packetMutationToken = 0;
  state.judgeOpen.detailViewIntent = "list";
  state.judgeOpen.tapePlaylist = [];
  state.judgeOpen.tapePlaylistIndex = 0;
  state.judgeOpen.tapePlaybackPacketId = null;
  state.judgeOpen.tapePlaylistSig = "";
  state.judgeOpen.tapeDurationSec = 0;
  state.judgeOpen.loadedSegmentAudioSessionId = null;
  state.judgeOpen.openSessionsPendingRender = null;
  if (state.judgeOpen.openSessionsRafId != null) {
    window.cancelAnimationFrame(state.judgeOpen.openSessionsRafId);
  }
  state.judgeOpen.openSessionsRafId = null;
  state.judgeOpen.openSessionsLastSig = "";
  state.judgeOpen.openSessionsSnapshotCount = 0;
  state.judgeOpen.openSessionsRenderCount = 0;
  state.judgeOpen.openPacketsPendingRender = null;
  if (state.judgeOpen.openPacketsRafId != null) {
    window.cancelAnimationFrame(state.judgeOpen.openPacketsRafId);
  }
  state.judgeOpen.openPacketsRafId = null;
  state.judgeOpen.openPacketsLastSig = "";
  state.judgeOpen.draftDirty = false;
  clearAutoTranscriptionRuntimeState();
}

export function markJudgeOpenDirty() {
  state.judgeOpen.draftDirty = true;
  state.judgeOpen.draftVersion += 1;
}

export function clearJudgeOpenDirty() {
  state.judgeOpen.draftDirty = false;
}

export function hasJudgeOpenUnsavedChanges() {
  return state.judgeOpen.draftDirty;
}

export function setJudgeOpenAutoTranscriptionHooks(hooks = {}) {
  judgeOpenAutoTranscriptionHooks = {
    ...judgeOpenAutoTranscriptionHooks,
    ...hooks,
  };
}

async function runAutoTranscriptionForSession(sessionId) {
  if (!state.judgeOpen.currentPacketId || !sessionId) return;
  if (state.judgeOpen.currentPacket?.locked) return;
  if (state.judgeOpen.autoTranscribeInFlight[sessionId]) return;
  state.judgeOpen.autoTranscribeInFlight[sessionId] = true;
  clearAutoTranscriptionRetryTimer(sessionId);
  try {
    patchLocalSessionState(sessionId, { transcriptStatus: "running", transcriptError: "" });
    setAutoTranscriptStatus("Transcription processing automatically...");
    const result = await transcribeOpenSegment({ sessionId });
    if (!result?.ok) {
      throw result?.error || new Error(result?.message || "Segment transcription failed.");
    }
    patchLocalSessionState(sessionId, {
      transcript: String(result.transcript || ""),
      transcriptStatus: "complete",
      transcriptError: "",
    });
    state.judgeOpen.autoTranscribeRetryCount[sessionId] = 0;
    delete state.judgeOpen.autoTranscribePendingSince[sessionId];
    await syncOpenTranscriptFromSessionState();
    setAutoTranscriptStatus("Transcript updated.");
  } catch (error) {
    const retries = Number(state.judgeOpen.autoTranscribeRetryCount[sessionId] || 0);
    if (retries < OPEN_AUTO_TRANSCRIBE_MAX_RETRIES) {
      const nextRetries = retries + 1;
      state.judgeOpen.autoTranscribeRetryCount[sessionId] = nextRetries;
      const waitMs = OPEN_AUTO_TRANSCRIBE_RETRY_BASE_MS * 2 ** (nextRetries - 1);
      setAutoTranscriptStatus("Transcription retrying...");
      state.judgeOpen.autoTranscribeRetryTimers[sessionId] = window.setTimeout(() => {
        delete state.judgeOpen.autoTranscribeRetryTimers[sessionId];
        void runAutoTranscriptionForSession(sessionId);
      }, waitMs);
    } else {
      patchLocalSessionState(sessionId, {
        transcriptStatus: "failed",
        transcriptError: String(error?.message || "Transcription failed."),
      });
      await syncOpenTranscriptFromSessionState();
      setAutoTranscriptStatus("Some recording parts could not be transcribed yet.");
    }
  } finally {
    delete state.judgeOpen.autoTranscribeInFlight[sessionId];
  }
}

function queueEligibleSessionAutoTranscription(sessions = []) {
  if (!state.judgeOpen.currentPacketId) return;
  if (state.judgeOpen.currentPacket?.locked) return;
  if (state.judgeOpen.autoStopTranscribeInFlight) return;
  const now = Date.now();
  sessions.forEach((session) => {
    if (!isSessionReadyForAutoTranscription(session)) return;
    const sessionId = session.id;
    if (!sessionId) return;
    if (state.judgeOpen.autoTranscribeInFlight[sessionId]) return;
    if (state.judgeOpen.autoTranscribeRetryTimers[sessionId] != null) return;
    const pendingSince = Number(state.judgeOpen.autoTranscribePendingSince[sessionId] || 0);
    if (!pendingSince) {
      state.judgeOpen.autoTranscribePendingSince[sessionId] = now;
      state.judgeOpen.autoTranscribeRetryTimers[sessionId] = window.setTimeout(() => {
        delete state.judgeOpen.autoTranscribeRetryTimers[sessionId];
        void runAutoTranscriptionForSession(sessionId);
      }, OPEN_AUTO_TRANSCRIBE_SETTLE_MS);
      return;
    }
    if (now - pendingSince >= OPEN_AUTO_TRANSCRIBE_SETTLE_MS) {
      void runAutoTranscriptionForSession(sessionId);
    }
  });
}

export async function watchOpenPackets(callback) {
  if (!state.auth.currentUser) {
    callback?.([]);
    return;
  }
  const packetsQuery = query(
    collection(db, COLLECTIONS.packets),
    where(FIELDS.packets.createdByJudgeUid, "==", state.auth.currentUser.uid),
    orderBy(FIELDS.packets.updatedAt, "desc"),
    limit(25)
  );
  return onSnapshot(packetsQuery, (snapshot) => {
    state.judgeOpen.packets = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
      display: buildPacketDisplay(docSnap.data()),
    }));
    callback?.(state.judgeOpen.packets);
  });
}

export function watchOpenSessions(packetId, callback) {
  if (state.subscriptions.openSessions) state.subscriptions.openSessions();
  if (state.judgeOpen.openSessionsRafId != null) {
    window.cancelAnimationFrame(state.judgeOpen.openSessionsRafId);
    state.judgeOpen.openSessionsRafId = null;
  }
  state.judgeOpen.openSessionsPendingRender = null;
  state.judgeOpen.openSessionsLastSig = "";
  state.judgeOpen.openSessionsSnapshotCount = 0;
  state.judgeOpen.openSessionsRenderCount = 0;
  if (!packetId) {
    state.judgeOpen.sessions = [];
    clearAutoTranscriptionRuntimeState();
    flushOpenSessionsRender(callback);
    return;
  }
  const sessionsQuery = query(
    collection(db, COLLECTIONS.packets, packetId, "sessions"),
    orderBy("startedAt", "asc")
  );
  state.subscriptions.openSessions = onSnapshot(sessionsQuery, (snapshot) => {
    state.judgeOpen.sessions = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    state.judgeOpen.openSessionsSnapshotCount += 1;
    state.judgeOpen.openSessionsPendingRender = state.judgeOpen.sessions;
    scheduleOpenSessionsRender(callback);
    queueEligibleSessionAutoTranscription(state.judgeOpen.sessions);
  });
}

export async function selectOpenPacket(packetId, { onSessions } = {}) {
  if (!packetId) return { ok: false, reason: "missing-packet" };
  const packetRef = doc(db, COLLECTIONS.packets, packetId);
  const packetSnap = await getDoc(packetRef);
  if (!packetSnap.exists()) return { ok: false, reason: "not-found" };
  const packetData = packetSnap.data() || {};
  state.judgeOpen.currentPacketId = packetId;
  state.judgeOpen.currentPacket = {
    id: packetSnap.id,
    ...packetData,
    mode: packetData.mode === "official" ? "official" : "practice",
  };
  clearAutoTranscriptionRuntimeState();
  state.judgeOpen.formType = packetData.formType || "stage";
  state.judgeOpen.transcriptText =
    packetData.transcriptFull || packetData.transcript || "";
  state.judgeOpen.captions = normalizeCaptions(
    packetData.formType || "stage",
    packetData.captions || {}
  );
  state.judgeOpen.selectedExisting = packetData.ensembleId
    ? {
        schoolId: packetData.schoolId || "",
        schoolName: packetData.schoolName || "",
        ensembleId: packetData.ensembleId || "",
        ensembleName: packetData.ensembleName || "",
      }
    : null;
  state.judgeOpen.directorEntryReference = packetData.directorEntrySnapshot || null;
  state.judgeOpen.directorEntryReferenceStatus = state.judgeOpen.directorEntryReference
    ? "loaded"
    : "idle";
  state.judgeOpen.directorEntryReferenceMessage = "";
  state.judgeOpen.draftDirty = false;
  saveOpenPrefs({ lastPacketId: packetSnap.id, lastFormType: state.judgeOpen.formType });
  watchOpenSessions(packetId, onSessions);
  return { ok: true, packet: state.judgeOpen.currentPacket };
}

export async function createOpenPacket({
  schoolName,
  ensembleName,
  schoolId,
  ensembleId,
  ensembleSnapshot,
  directorEntrySnapshot,
  formType,
  onSessions,
  autoSelect = true,
  mode = "practice",
} = {}) {
  if (!state.auth.currentUser || !state.auth.userProfile) {
    return { ok: false, message: "Sign in as a judge to create packets." };
  }
  if (!String(schoolId || "").trim() || !String(ensembleId || "").trim()) {
    return { ok: false, message: "Select an existing school and ensemble." };
  }
  const createFn = httpsCallable(functions, "createOpenPacket");
  const response = await createFn({
    schoolName: schoolName || "",
    ensembleName: ensembleName || "",
    schoolId: schoolId || "",
    ensembleId: ensembleId || "",
    ensembleSnapshot: ensembleSnapshot || null,
    directorEntrySnapshot: directorEntrySnapshot || null,
    formType: formType || FORM_TYPES.stage,
    mode: mode === "official" ? "official" : "practice",
    useActiveEventDefaults: state.judgeOpen.useActiveEventDefaults !== false,
    createdByJudgeName:
      state.auth.userProfile?.displayName || state.auth.currentUser.displayName || "",
    createdByJudgeEmail:
      state.auth.userProfile?.email || state.auth.currentUser.email || "",
  });
  const packetId = response.data?.packetId || null;
  if (!packetId) return { ok: false, message: "Failed to create packet." };
  saveOpenPrefs({ lastPacketId: packetId, lastFormType: formType || FORM_TYPES.stage });
  if (autoSelect) {
    await selectOpenPacket(packetId, { onSessions });
  }
  return { ok: true, packetId };
}

export async function updateOpenPacketDraft(
  payload = {},
  { clearDirtyIfUnchanged = false, startVersion = null } = {}
) {
  if (!state.judgeOpen.currentPacketId) return { ok: false, reason: "no-packet" };
  const packetRef = doc(db, COLLECTIONS.packets, state.judgeOpen.currentPacketId);
  await updateDoc(packetRef, {
    ...payload,
    [FIELDS.packets.updatedAt]: serverTimestamp(),
  });
  if (!clearDirtyIfUnchanged) return { ok: true, cleared: false };
  const baseVersion =
    Number.isFinite(startVersion) ? Number(startVersion) : state.judgeOpen.draftVersion;
  if (state.judgeOpen.draftVersion === baseVersion) {
    state.judgeOpen.draftDirty = false;
    return { ok: true, cleared: true };
  }
  return { ok: true, cleared: false };
}

export async function loadDirectorEntrySnapshotForJudge({ eventId, ensembleId } = {}) {
  if (!eventId) {
    return { ok: false, reason: "no-event", message: "No active event selected." };
  }
  if (!ensembleId) {
    return { ok: false, reason: "not-linked", message: "No ensemble linked." };
  }
  const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId);
  const snap = await getDoc(entryRef);
  if (!snap.exists()) {
    return { ok: false, reason: "not-found", message: "No Director entry found for active event." };
  }
  const eventName = state.event.active?.id === eventId
    ? (state.event.active?.name || eventId)
    : (state.event.list.find((item) => item.id === eventId)?.name || eventId);
  const snapshot = normalizeDirectorEntrySnapshot(snap.data(), { eventId, eventName });
  return { ok: true, snapshot };
}

export async function fetchOpenEnsembles(schoolId) {
  if (!schoolId) return [];
  const ensemblesRef = collection(db, COLLECTIONS.schools, schoolId, "ensembles");
  const ensemblesQuery = query(ensemblesRef, orderBy("name"));
  const snapshot = await getDocs(ensemblesQuery);
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

export async function fetchOpenEnsembleIndex(schoolsList) {
  const schools = Array.isArray(schoolsList) ? schoolsList : [];
  if (!schools.length) return [];
  const schoolNameById = new Map(
    schools.map((school) => [String(school.id || ""), school.name || school.id || ""])
  );
  const schoolIds = Array.from(schoolNameById.keys()).filter(Boolean).sort();
  const cacheKey = schoolIds.join("|");
  const now = Date.now();
  if (
    openEnsembleIndexCache.key === cacheKey &&
    now - openEnsembleIndexCache.cachedAt < OPEN_ENSEMBLE_INDEX_CACHE_TTL_MS
  ) {
    return openEnsembleIndexCache.items;
  }
  if (openEnsembleIndexCache.key === cacheKey && openEnsembleIndexCache.inFlight) {
    return openEnsembleIndexCache.inFlight;
  }

  const loader = (async () => {
    try {
      const snapshot = await getDocs(query(collectionGroup(db, COLLECTIONS.ensembles)));
      const items = snapshot.docs
        .map((docSnap) => {
          const schoolId = docSnap.ref.parent?.parent?.id || "";
          if (!schoolNameById.has(schoolId)) return null;
          const data = docSnap.data() || {};
          return {
            schoolId,
            schoolName: schoolNameById.get(schoolId) || schoolId,
            ensembleId: docSnap.id,
            ensembleName: data.name || docSnap.id,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const schoolCmp = String(a.schoolName || "").localeCompare(String(b.schoolName || ""));
          if (schoolCmp !== 0) return schoolCmp;
          return String(a.ensembleName || "").localeCompare(String(b.ensembleName || ""));
        });
      openEnsembleIndexCache = {
        key: cacheKey,
        cachedAt: Date.now(),
        items,
        inFlight: null,
      };
      return items;
    } catch (error) {
      // Fallback to legacy fan-out so the Judge page still works if collectionGroup is denied.
      console.warn("fetchOpenEnsembleIndex collectionGroup failed; falling back", error);
      const results = await Promise.all(
        schools.map(async (school) => {
          const ensembles = await fetchOpenEnsembles(school.id);
          return ensembles.map((ensemble) => ({
            schoolId: school.id,
            schoolName: school.name || school.id,
            ensembleId: ensemble.id,
            ensembleName: ensemble.name || ensemble.id,
          }));
        })
      );
      const items = results.flat();
      openEnsembleIndexCache = {
        key: cacheKey,
        cachedAt: Date.now(),
        items,
        inFlight: null,
      };
      return items;
    }
  })();

  openEnsembleIndexCache = {
    key: cacheKey,
    cachedAt: openEnsembleIndexCache.cachedAt,
    items: openEnsembleIndexCache.items,
    inFlight: loader,
  };
  return loader;
}

export async function fetchOfficialOpenEnsembleIndex(eventId) {
  const targetEventId = String(eventId || "").trim();
  if (!targetEventId) return [];
  const scheduleRef = collection(db, COLLECTIONS.events, targetEventId, COLLECTIONS.schedule);
  const scheduleSnap = await getDocs(query(scheduleRef, orderBy("performanceAt", "asc")));
  const dedupe = new Map();
  scheduleSnap.docs.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const schoolId = String(row.schoolId || "").trim();
    const ensembleId = String(row.ensembleId || "").trim();
    if (!schoolId || !ensembleId) return;
    const key = `${schoolId}:${ensembleId}`;
    if (dedupe.has(key)) return;
    dedupe.set(key, {
      schoolId,
      schoolName: String(row.schoolName || schoolId),
      ensembleId,
      ensembleName: String(row.ensembleName || ensembleId),
    });
  });
  return Array.from(dedupe.values());
}

export function loadOpenPrefs() {
  try {
    const raw = window.localStorage.getItem(OPEN_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

export function saveOpenPrefs(next) {
  const current = loadOpenPrefs();
  const merged = { ...current, ...next };
  window.localStorage.setItem(OPEN_PREFS_KEY, JSON.stringify(merged));
  return merged;
}

export async function saveOpenPrefsToServer(preferences) {
  if (!state.auth.currentUser || !state.auth.userProfile) return { ok: false };
  const setPrefsFn = httpsCallable(functions, "setUserPrefs");
  return setPrefsFn({ preferences });
}

function getSessionStoragePath({ packetId, sessionId, chunkIndex, isMaster = false }) {
  const uid = state.auth.currentUser?.uid || "unknown";
  if (isMaster) {
    return `packet_audio/${uid}/${packetId}/${sessionId}/master.webm`;
  }
  return `packet_audio/${uid}/${packetId}/${sessionId}/chunk_${chunkIndex}.webm`;
}

function ensureRetryState(sessionId) {
  if (!state.judgeOpen.retryUploads[sessionId]) {
    state.judgeOpen.retryUploads[sessionId] = { chunks: {}, master: null };
  }
  return state.judgeOpen.retryUploads[sessionId];
}

function clearOpenRolloverTimer() {
  if (state.judgeOpen.recordingRolloverTimerId != null) {
    window.clearTimeout(state.judgeOpen.recordingRolloverTimerId);
    state.judgeOpen.recordingRolloverTimerId = null;
  }
}

function normalizeMicrophoneLabel(device = {}, index = 0) {
  const label = String(device?.label || "").trim();
  if (label) {
    const rewrite = OPEN_MIC_LABEL_REWRITES.find(({ pattern }) => pattern.test(label));
    if (rewrite) return rewrite.label;
    return label;
  }
  return `Microphone ${index + 1}`;
}

function normalizeMicrophoneOptions(devices = []) {
  return devices
    .filter((device) => device?.kind === "audioinput")
    .map((device, index) => ({
      deviceId: String(device.deviceId || ""),
      groupId: String(device.groupId || ""),
      label: normalizeMicrophoneLabel(device, index),
    }));
}

export async function refreshOpenMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.judgeOpen.availableMicrophones = [];
    state.judgeOpen.selectedMicLabel = "";
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = normalizeMicrophoneOptions(devices);
  state.judgeOpen.availableMicrophones = microphones;
  const selectedDeviceId = String(state.judgeOpen.selectedMicDeviceId || "");
  const selected =
    microphones.find((device) => device.deviceId === selectedDeviceId) || null;
  state.judgeOpen.selectedMicLabel = selected?.label || "";
  if (selectedDeviceId && !selected) {
    state.judgeOpen.selectedMicDeviceId = "";
  }
  return microphones;
}

export async function startOpenRecording({
  onStatus,
  onSessions,
  getPacketMeta,
  continuation = false,
} = {}) {
  if (!state.judgeOpen.mode) {
    return { ok: false, message: "Choose Practice or Official before recording." };
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return { ok: false, message: "Recording is not supported in this browser." };
  }
  if (state.judgeOpen.mediaRecorder?.state === "recording") {
    return { ok: false, message: "Recording already in progress." };
  }
  if (Number(state.judgeOpen.pendingUploads || 0) > 0) {
    return { ok: false, message: "Please wait for the previous recording to finish uploading." };
  }
  const cooldownRemainingMs = Number(state.judgeOpen.recordingCooldownUntil || 0) - Date.now();
  if (cooldownRemainingMs > 0) {
    const waitSeconds = Math.max(1, Math.ceil(cooldownRemainingMs / 1000));
    return {
      ok: false,
      message: `Please wait ${waitSeconds}s before starting the next recording.`,
    };
  }
  if (!continuation) {
    state.judgeOpen.recordingKeepAlive = true;
  }
  state.judgeOpen.recordingAutoRolloverReason = "";
  const meta = getPacketMeta?.() || {};
  if (!state.judgeOpen.currentPacketId) {
    const created = await createOpenPacket({ ...meta, onSessions });
    if (!created.ok) return created;
  } else if (meta && Object.keys(meta).length) {
    await updateOpenPacketDraft(meta);
  }

  const packetId = state.judgeOpen.currentPacketId;
  const sessionsRef = collection(db, COLLECTIONS.packets, packetId, "sessions");
  const sessionRef = doc(sessionsRef);
  const sessionId = sessionRef.id;
  ensureRetryState(sessionId);
  state.judgeOpen.activeSessionId = sessionId;
  state.judgeOpen.recordingChunks = [];
  state.judgeOpen.pendingUploads = 0;

  await setDoc(sessionRef, {
    createdAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    createdByJudgeUid: state.auth.currentUser.uid,
    status: "recording",
    chunkCount: 0,
  });

  let stream;
  const selectedMicDeviceId = String(state.judgeOpen.selectedMicDeviceId || "").trim();
  const selectedConstraints = selectedMicDeviceId
    ? {
        audio: {
          ...OPEN_AUDIO_CONSTRAINTS.audio,
          deviceId: { exact: selectedMicDeviceId },
        },
      }
    : OPEN_AUDIO_CONSTRAINTS;
  try {
    stream = await navigator.mediaDevices.getUserMedia(selectedConstraints);
  } catch (error) {
    if (
      selectedMicDeviceId &&
      ["NotFoundError", "OverconstrainedError"].includes(String(error?.name || ""))
    ) {
      await refreshOpenMicrophones();
      return {
        ok: false,
        message: "Selected microphone is unavailable. Choose another microphone and try again.",
      };
    }
    // Fallback for browsers that reject one or more advanced audio constraints.
    stream = await navigator.mediaDevices.getUserMedia(
      selectedMicDeviceId ? { audio: { deviceId: { exact: selectedMicDeviceId } } } : { audio: true }
    );
  }
  const audioTrack = stream.getAudioTracks?.()[0] || null;
  state.judgeOpen.micTrackSettings =
    typeof audioTrack?.getSettings === "function" ? audioTrack.getSettings() : null;
  await refreshOpenMicrophones();
  const activeDeviceId = String(state.judgeOpen.micTrackSettings?.deviceId || "");
  if (activeDeviceId) {
    state.judgeOpen.selectedMicDeviceId = activeDeviceId;
    const activeMic = state.judgeOpen.availableMicrophones.find(
      (device) => device.deviceId === activeDeviceId
    );
    state.judgeOpen.selectedMicLabel = activeMic?.label || state.judgeOpen.selectedMicLabel || "";
  }

  const options = MediaRecorder.isTypeSupported("audio/webm")
    ? {
        mimeType: "audio/webm",
        audioBitsPerSecond: OPEN_RECORDING_AUDIO_BITS_PER_SECOND,
      }
    : {
        audioBitsPerSecond: OPEN_RECORDING_AUDIO_BITS_PER_SECOND,
      };
  const recorder = new MediaRecorder(stream, options);
  state.judgeOpen.mediaRecorder = recorder;

  clearOpenRolloverTimer();
  state.judgeOpen.recordingRolloverTimerId = window.setTimeout(() => {
    const activeRecorder = state.judgeOpen.mediaRecorder;
    if (!state.judgeOpen.recordingKeepAlive) return;
    if (!activeRecorder || activeRecorder !== recorder) return;
    if (activeRecorder.state !== "recording") return;
    state.judgeOpen.recordingAutoRolloverReason = "max-segment";
    activeRecorder.stop();
  }, OPEN_RECORDING_MAX_SEGMENT_MS);

  recorder.addEventListener("dataavailable", async (event) => {
    if (!event.data || event.data.size === 0) return;
    state.judgeOpen.recordingChunks.push(event.data);
  });

  recorder.addEventListener("stop", async () => {
    state.judgeOpen.recordingCooldownUntil = Date.now() + OPEN_RECORDING_RESTART_COOLDOWN_MS;
    clearOpenRolloverTimer();
    const shouldAutoContinue =
      state.judgeOpen.recordingKeepAlive &&
      state.judgeOpen.recordingAutoRolloverReason === "max-segment";
    state.judgeOpen.recordingAutoRolloverReason = "";
    const blob = new Blob(state.judgeOpen.recordingChunks, {
      type: recorder.mimeType || "audio/webm",
    });
    const retryState = ensureRetryState(sessionId);
    retryState.master = blob;
    const objectPath = getSessionStoragePath({ packetId, sessionId, isMaster: true });
    const storageRef = ref(storage, objectPath);
    let audioUrl = "";
    state.judgeOpen.pendingUploads += 1;
    onStatus?.();
    try {
      await uploadBytes(storageRef, blob, { contentType: recorder.mimeType || "audio/webm" });
      audioUrl = await getDownloadURL(storageRef);
      retryState.master = null;
    } catch (error) {
      await updateDoc(sessionRef, {
        needsUpload: true,
        updatedAt: serverTimestamp(),
      });
    } finally {
      state.judgeOpen.pendingUploads = Math.max(0, state.judgeOpen.pendingUploads - 1);
      onStatus?.();
    }
    const audio = new Audio();
    const blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    audio.onloadedmetadata = async () => {
      try {
        const durationSec = Number(audio.duration || 0);
        const audioSegments = upsertPacketAudioSegment({
          sessionId,
          label: `Part ${Number((state.judgeOpen.currentPacket?.segmentCount || 0)) + 1}`,
          audioUrl,
          audioPath: objectPath,
          durationSec,
          sortOrder: Number(state.judgeOpen.currentPacket?.segmentCount || 0),
        });
        await updateDoc(sessionRef, {
          status: "completed",
          durationSec,
          masterAudioUrl: audioUrl,
          masterAudioPath: objectPath,
          chunkCount: blob.size > 0 ? 1 : 0,
          needsUpload: Boolean(!audioUrl),
          endedAt: serverTimestamp(),
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, COLLECTIONS.packets, packetId), {
          [FIELDS.packets.tapeDurationSec]: increment(durationSec || 0),
          [FIELDS.packets.segmentCount]: increment(1),
          [FIELDS.packets.audioSegments]: audioSegments,
          [FIELDS.packets.updatedAt]: serverTimestamp(),
        });
      } catch (error) {
        console.error("Failed to finalize recorded open session metadata", error);
      } finally {
        URL.revokeObjectURL(blobUrl);
        audio.removeAttribute("src");
      }
    };
    audio.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      audio.removeAttribute("src");
    };
    await updateDoc(doc(db, COLLECTIONS.packets, packetId), {
      [FIELDS.packets.activeSessionId]: sessionId,
      [FIELDS.packets.audioSessionCount]: increment(1),
      ...(audioUrl
        ? {
            [FIELDS.packets.latestAudioUrl]: audioUrl,
            [FIELDS.packets.latestAudioPath]: objectPath,
          }
        : {}),
      [FIELDS.packets.updatedAt]: serverTimestamp(),
    });
    state.judgeOpen.recordingChunks = [];
    state.judgeOpen.mediaRecorder = null;
    state.judgeOpen.activeSessionId = null;
    state.judgeOpen.micTrackSettings = null;
    stream.getTracks().forEach((track) => track.stop());
    onStatus?.();
    if (shouldAutoContinue) {
      try {
        state.judgeOpen.recordingCooldownUntil = 0;
        const next = await startOpenRecording({
          onStatus,
          onSessions,
          getPacketMeta,
          continuation: true,
        });
        if (!next?.ok) {
          state.judgeOpen.recordingKeepAlive = false;
        }
      } catch (error) {
        console.error("Failed to auto-rollover open recording segment", error);
        state.judgeOpen.recordingKeepAlive = false;
      } finally {
        onStatus?.();
      }
    }
  });

  recorder.start();
  onStatus?.();
  return { ok: true, sessionId };
}

export function stopOpenRecording() {
  const recorder = state.judgeOpen.mediaRecorder;
  if (!recorder || recorder.state !== "recording") return { ok: false };
  state.judgeOpen.recordingKeepAlive = false;
  state.judgeOpen.recordingAutoRolloverReason = "";
  state.judgeOpen.recordingCooldownUntil = Date.now() + OPEN_RECORDING_RESTART_COOLDOWN_MS;
  clearOpenRolloverTimer();
  recorder.stop();
  return { ok: true };
}

export async function retryOpenSessionUploads(sessionId) {
  const packetId = state.judgeOpen.currentPacketId;
  if (!packetId) return { ok: false, message: "No active packet." };
  const retryState = state.judgeOpen.retryUploads[sessionId];
  if (!retryState) {
    return { ok: false, message: "No local data to retry." };
  }
  const sessionRef = doc(db, COLLECTIONS.packets, packetId, "sessions", sessionId);
  const chunkEntries = Object.entries(retryState.chunks || {}).sort(
    ([a], [b]) => Number(a) - Number(b)
  );
  for (const [index, blob] of chunkEntries) {
    const objectPath = getSessionStoragePath({
      packetId,
      sessionId,
      chunkIndex: Number(index),
    });
    const storageRef = ref(storage, objectPath);
    try {
      await uploadBytes(storageRef, blob, { contentType: blob.type || "audio/webm" });
      delete retryState.chunks[index];
    } catch (error) {
      await updateDoc(sessionRef, { needsUpload: true, updatedAt: serverTimestamp() });
      return { ok: false, message: "Retry failed on chunk upload." };
    }
  }

  if (retryState.master) {
    const objectPath = getSessionStoragePath({ packetId, sessionId, isMaster: true });
    const storageRef = ref(storage, objectPath);
    try {
      await uploadBytes(storageRef, retryState.master, {
        contentType: retryState.master.type || "audio/webm",
      });
      const audioUrl = await getDownloadURL(storageRef);
      retryState.master = null;
      const existingIndex = Array.isArray(state.judgeOpen.currentPacket?.audioSegments)
        ? state.judgeOpen.currentPacket.audioSegments.findIndex((segment) => segment?.sessionId === sessionId)
        : -1;
      const audioSegments = upsertPacketAudioSegment({
        sessionId,
        label: `Part ${existingIndex >= 0 ? existingIndex + 1 : (state.judgeOpen.currentPacket?.audioSegments?.length || 0) + 1}`,
        audioUrl,
        audioPath: objectPath,
        durationSec: Number(
          (state.judgeOpen.sessions || []).find((session) => session.id === sessionId)?.durationSec || 0
        ),
        sortOrder: existingIndex >= 0 ? existingIndex : (state.judgeOpen.currentPacket?.audioSegments?.length || 0),
      });
      await updateDoc(sessionRef, {
        masterAudioUrl: audioUrl,
        masterAudioPath: objectPath,
        needsUpload: false,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, COLLECTIONS.packets, packetId), {
        [FIELDS.packets.latestAudioUrl]: audioUrl,
        [FIELDS.packets.latestAudioPath]: objectPath,
        [FIELDS.packets.audioSegments]: audioSegments,
        [FIELDS.packets.updatedAt]: serverTimestamp(),
      });
    } catch (error) {
      await updateDoc(sessionRef, { needsUpload: true, updatedAt: serverTimestamp() });
      return { ok: false, message: "Retry failed on master upload." };
    }
  } else {
    await updateDoc(sessionRef, { needsUpload: false, updatedAt: serverTimestamp() });
  }

  return { ok: true };
}

export async function deleteOpenSession({ sessionId } = {}) {
  if (!state.judgeOpen.currentPacketId) {
    return { ok: false, message: "Create an adjudication first." };
  }
  if (!sessionId) {
    return { ok: false, message: "Select a recording first." };
  }
  const deleteFn = httpsCallable(functions, "deleteOpenPacketSession");
  try {
    const response = await deleteFn({
      packetId: state.judgeOpen.currentPacketId,
      sessionId,
    });
    delete state.judgeOpen.retryUploads[sessionId];
    delete state.judgeOpen.autoTranscribeInFlight[sessionId];
    delete state.judgeOpen.autoTranscribeRetryCount[sessionId];
    delete state.judgeOpen.autoTranscribePendingSince[sessionId];
    if (state.judgeOpen.autoTranscribeRetryTimers[sessionId] != null) {
      window.clearTimeout(state.judgeOpen.autoTranscribeRetryTimers[sessionId]);
      delete state.judgeOpen.autoTranscribeRetryTimers[sessionId];
    }
    if (state.judgeOpen.loadedSegmentAudioSessionId === sessionId) {
      state.judgeOpen.loadedSegmentAudioSessionId = null;
    }
    if (state.judgeOpen.activeSessionId === sessionId) {
      state.judgeOpen.activeSessionId = null;
    }
    return response.data || { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to delete recording.",
      error,
    };
  }
}

export async function transcribeOpenTape() {
  if (!state.judgeOpen.currentPacketId) return { ok: false, message: "Create an adjudication first." };
  const packetId = state.judgeOpen.currentPacketId;
  const transcribeFn = httpsCallable(functions, "transcribePacketTape");
  try {
    const response = await transcribeFn({ packetId });
    const transcript = response.data?.transcriptFull || "";
    state.judgeOpen.transcriptText = transcript;
    await updateOpenPacketDraft({
      [FIELDS.packets.transcriptFull]: transcript,
      [FIELDS.packets.transcript]: transcript,
      [FIELDS.packets.transcriptStatus]: response.data?.transcriptStatus || "complete",
      [FIELDS.packets.transcriptError]: "",
    });
    return { ok: true, transcript };
  } catch (error) {
    const message = error?.message || "Transcription failed.";
    await updateOpenPacketDraft({
      [FIELDS.packets.transcriptStatus]: "failed",
      [FIELDS.packets.transcriptError]: message,
    });
    return { ok: false, message, error };
  }
}

export async function finalizeOpenTapeAutoTranscription() {
  if (!state.judgeOpen.currentPacketId) {
    return { ok: false, message: "Create an adjudication first." };
  }
  if (state.judgeOpen.autoStopTranscribeInFlight) {
    return { ok: false, message: "Transcription already running." };
  }
  state.judgeOpen.autoStopTranscribeInFlight = true;
  setAutoTranscriptStatus("Finalizing transcript...");
  try {
    const result = await transcribeOpenTape();
    if (!result?.ok) {
      setAutoTranscriptStatus("Final transcript check failed.");
      return result;
    }
    judgeOpenAutoTranscriptionHooks.onTranscriptUpdated?.(result.transcript || "", {
      source: "auto-stop",
    });
    setAutoTranscriptStatus("Transcript ready.");
    return result;
  } finally {
    state.judgeOpen.autoStopTranscribeInFlight = false;
  }
}

export async function transcribeOpenSegment({ sessionId } = {}) {
  if (!state.judgeOpen.currentPacketId) return { ok: false, message: "Create an adjudication first." };
  const packetId = state.judgeOpen.currentPacketId;
  if (!sessionId) return { ok: false, message: "Select a segment first." };
  const transcribeFn = httpsCallable(functions, "transcribePacketSegment");
  try {
    const response = await transcribeFn({ packetId, sessionId });
    return { ok: true, transcript: response.data?.transcript || "" };
  } catch (error) {
    const message = error?.message || "Segment transcription failed.";
    return { ok: false, message, error };
  }
}

export function calculateCaptionTotal(captions) {
  return Object.values(captions).reduce((sum, caption) => {
    const score = GRADE_VALUES[caption.gradeLetter] ?? 0;
    return sum + score;
  }, 0);
}

export function computeFinalRating(total) {
  if (total >= 7 && total <= 10) return { label: "I", value: 1 };
  if (total >= 11 && total <= 17) return { label: "II", value: 2 };
  if (total >= 18 && total <= 24) return { label: "III", value: 3 };
  if (total >= 25 && total <= 31) return { label: "IV", value: 4 };
  if (total >= 32 && total <= 35) return { label: "V", value: 5 };
  return { label: "N/A", value: null };
}

export function getOpenCaptionTemplate() {
  const formType = state.judgeOpen.formType || FORM_TYPES.stage;
  return CAPTION_TEMPLATES[formType] || [];
}

export async function submitOpenPacket() {
  if (!state.judgeOpen.currentPacketId) {
    return { ok: false, message: "Create an adjudication first." };
  }
  const captionScoreTotal = calculateCaptionTotal(state.judgeOpen.captions);
  const rating = computeFinalRating(captionScoreTotal);
  const selectedExisting = state.judgeOpen.selectedExisting || {};
  const schoolName =
    selectedExisting.schoolName ||
    state.judgeOpen.currentPacket?.schoolName ||
    "";
  const ensembleName =
    selectedExisting.ensembleName ||
    state.judgeOpen.currentPacket?.ensembleName ||
    "";
  const schoolId = selectedExisting.schoolId || state.judgeOpen.currentPacket?.schoolId || "";
  const ensembleId =
    selectedExisting.ensembleId || state.judgeOpen.currentPacket?.ensembleId || "";
  if (!schoolId || !ensembleId) {
    return { ok: false, message: "Select an existing school and ensemble before submit." };
  }
  const ensembleSnapshot =
    schoolId && ensembleId
      ? {
          schoolId,
          schoolName,
          ensembleId,
          ensembleName,
        }
      : null;
  const submitFn = httpsCallable(functions, "submitOpenPacket");
  const mode = state.judgeOpen.mode === "official" ? "official" : "practice";
  const packet = state.judgeOpen.currentPacket || {};
  const officialEventId =
    mode === "official"
      ? String(
          packet.officialEventId ||
            packet.assignmentEventId ||
            state.judgeOpen.activeEventAssignment?.eventId ||
            ""
        ).trim()
      : "";
  const officialJudgePosition =
    mode === "official"
      ? String(
          packet.officialJudgePosition ||
            packet.judgePosition ||
            state.judgeOpen.activeEventAssignment?.judgePosition ||
            ""
        ).trim()
      : "";
  try {
    const response = await submitFn({
      packetId: state.judgeOpen.currentPacketId,
      mode,
      officialEventId,
      officialJudgePosition,
      officialSubmissionId:
        mode === "official" && officialEventId && ensembleId && officialJudgePosition
          ? `${officialEventId}_${ensembleId}_${officialJudgePosition}`
          : "",
      schoolName,
      ensembleName,
      schoolId,
      ensembleId,
      ensembleSnapshot,
      directorEntrySnapshot:
        state.judgeOpen.directorEntryReferenceStatus === "loaded"
          ? state.judgeOpen.directorEntryReference
          : (state.judgeOpen.currentPacket?.directorEntrySnapshot || null),
      formType: state.judgeOpen.formType || FORM_TYPES.stage,
      useActiveEventDefaults: state.judgeOpen.useActiveEventDefaults !== false,
      transcript: state.judgeOpen.transcriptText || "",
      transcriptFull: state.judgeOpen.transcriptText || "",
      captions: state.judgeOpen.captions || {},
      captionScoreTotal,
      computedFinalRatingJudge: rating.value,
      computedFinalRatingLabel: rating.label,
    });
    return { ok: true, ...response.data };
  } catch (error) {
    const message = error?.message || "Unable to submit adjudication.";
    return { ok: false, message, error };
  }
}

export function isOpenPacketEditable(packet) {
  if (!packet) return true;
  if (packet.locked) return false;
  const status = packet.status || STATUSES.draft;
  return status === STATUSES.draft || status === STATUSES.reopened;
}
