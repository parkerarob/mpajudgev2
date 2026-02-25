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

const OPEN_RECORDING_TIMESLICE_MS = 10000;
const OPEN_PREFS_KEY = "judgeOpenPrefs";
const OPEN_ENSEMBLE_INDEX_CACHE_TTL_MS = 60 * 1000;
const OPEN_AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

let openEnsembleIndexCache = {
  key: "",
  cachedAt: 0,
  items: [],
  inFlight: null,
};

function buildPacketDisplay(packet) {
  const school = packet.schoolName || "Unknown school";
  const ensemble = packet.ensembleName || "Unknown ensemble";
  const status = packet.status || "draft";
  return `${school} - ${ensemble} - ${status}`;
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
}

export function markJudgeOpenDirty() {
  state.judgeOpen.draftDirty = true;
  state.judgeOpen.draftVersion += 1;
}

export function hasJudgeOpenUnsavedChanges() {
  return state.judgeOpen.draftDirty;
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
  if (!packetId) {
    state.judgeOpen.sessions = [];
    callback?.([]);
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
    callback?.(state.judgeOpen.sessions);
  });
}

export async function selectOpenPacket(packetId, { onSessions } = {}) {
  if (!packetId) return { ok: false, reason: "missing-packet" };
  const packetRef = doc(db, COLLECTIONS.packets, packetId);
  const packetSnap = await getDoc(packetRef);
  if (!packetSnap.exists()) return { ok: false, reason: "not-found" };
  state.judgeOpen.currentPacketId = packetId;
  state.judgeOpen.currentPacket = { id: packetSnap.id, ...packetSnap.data() };
  state.judgeOpen.formType = packetSnap.data().formType || "stage";
  state.judgeOpen.transcriptText =
    packetSnap.data().transcriptFull || packetSnap.data().transcript || "";
  state.judgeOpen.captions = normalizeCaptions(
    packetSnap.data().formType || "stage",
    packetSnap.data().captions || {}
  );
  state.judgeOpen.selectedExisting = packetSnap.data().ensembleId
    ? {
        schoolId: packetSnap.data().schoolId || "",
        schoolName: packetSnap.data().schoolName || "",
        ensembleId: packetSnap.data().ensembleId || "",
        ensembleName: packetSnap.data().ensembleName || "",
      }
    : null;
  state.judgeOpen.directorEntryReference = packetSnap.data().directorEntrySnapshot || null;
  state.judgeOpen.directorEntryReferenceStatus = state.judgeOpen.directorEntryReference
    ? "loaded"
    : "idle";
  state.judgeOpen.directorEntryReferenceMessage = "";
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
} = {}) {
  if (!state.auth.currentUser || !state.auth.userProfile) {
    return { ok: false, message: "Sign in as a judge to create packets." };
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
    useActiveEventDefaults: state.judgeOpen.useActiveEventDefaults !== false,
    createdByJudgeName:
      state.auth.userProfile?.displayName || state.auth.currentUser.displayName || "",
    createdByJudgeEmail:
      state.auth.userProfile?.email || state.auth.currentUser.email || "",
  });
  const packetId = response.data?.packetId || null;
  if (!packetId) return { ok: false, message: "Failed to create packet." };
  saveOpenPrefs({ lastPacketId: packetId, lastFormType: formType || FORM_TYPES.stage });
  await selectOpenPacket(packetId, { onSessions });
  return { ok: true, packetId };
}

export async function updateOpenPacketDraft(payload = {}) {
  if (!state.judgeOpen.currentPacketId) return { ok: false, reason: "no-packet" };
  const packetRef = doc(db, COLLECTIONS.packets, state.judgeOpen.currentPacketId);
  await updateDoc(packetRef, {
    ...payload,
    [FIELDS.packets.updatedAt]: serverTimestamp(),
  });
  return { ok: true };
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

export async function startOpenRecording({
  onStatus,
  onSessions,
  getPacketMeta,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return { ok: false, message: "Recording is not supported in this browser." };
  }
  if (state.judgeOpen.mediaRecorder?.state === "recording") {
    return { ok: false, message: "Recording already in progress." };
  }
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
  try {
    stream = await navigator.mediaDevices.getUserMedia(OPEN_AUDIO_CONSTRAINTS);
  } catch (error) {
    // Fallback for browsers that reject one or more advanced audio constraints.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  const audioTrack = stream.getAudioTracks?.()[0] || null;
  state.judgeOpen.micTrackSettings =
    typeof audioTrack?.getSettings === "function" ? audioTrack.getSettings() : null;

  const options = MediaRecorder.isTypeSupported("audio/webm")
    ? { mimeType: "audio/webm" }
    : {};
  const recorder = new MediaRecorder(stream, options);
  state.judgeOpen.mediaRecorder = recorder;
  let chunkIndex = 0;

  recorder.addEventListener("dataavailable", async (event) => {
    if (!event.data || event.data.size === 0) return;
    const chunk = event.data;
    state.judgeOpen.recordingChunks.push(chunk);
    chunkIndex += 1;
    const objectPath = getSessionStoragePath({ packetId, sessionId, chunkIndex });
    const storageRef = ref(storage, objectPath);
    state.judgeOpen.pendingUploads += 1;
    try {
      await uploadBytes(storageRef, chunk, { contentType: recorder.mimeType || "audio/webm" });
      const retryState = state.judgeOpen.retryUploads[sessionId];
      if (retryState?.chunks?.[chunkIndex]) {
        delete retryState.chunks[chunkIndex];
      }
      await updateDoc(sessionRef, {
        chunkCount: chunkIndex,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      const retryState = ensureRetryState(sessionId);
      retryState.chunks[chunkIndex] = chunk;
      await updateDoc(sessionRef, {
        needsUpload: true,
        updatedAt: serverTimestamp(),
      });
    } finally {
      state.judgeOpen.pendingUploads = Math.max(0, state.judgeOpen.pendingUploads - 1);
      onStatus?.();
    }
  });

  recorder.addEventListener("stop", async () => {
    const blob = new Blob(state.judgeOpen.recordingChunks, {
      type: recorder.mimeType || "audio/webm",
    });
    const retryState = ensureRetryState(sessionId);
    retryState.master = blob;
    const objectPath = getSessionStoragePath({ packetId, sessionId, isMaster: true });
    const storageRef = ref(storage, objectPath);
    let audioUrl = "";
    try {
      await uploadBytes(storageRef, blob, { contentType: recorder.mimeType || "audio/webm" });
      audioUrl = await getDownloadURL(storageRef);
      retryState.master = null;
    } catch (error) {
      await updateDoc(sessionRef, {
        needsUpload: true,
        updatedAt: serverTimestamp(),
      });
    }
    const audio = new Audio();
    audio.src = URL.createObjectURL(blob);
    audio.onloadedmetadata = async () => {
      const durationSec = Number(audio.duration || 0);
      await updateDoc(sessionRef, {
        status: "completed",
        durationSec,
        masterAudioUrl: audioUrl,
        masterAudioPath: objectPath,
        needsUpload: Boolean(Object.keys(retryState.chunks || {}).length || !audioUrl),
        endedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, COLLECTIONS.packets, packetId), {
        [FIELDS.packets.tapeDurationSec]: increment(durationSec || 0),
        [FIELDS.packets.segmentCount]: increment(1),
        [FIELDS.packets.updatedAt]: serverTimestamp(),
      });
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
  });

  recorder.start(OPEN_RECORDING_TIMESLICE_MS);
  onStatus?.();
  return { ok: true, sessionId };
}

export function stopOpenRecording() {
  const recorder = state.judgeOpen.mediaRecorder;
  if (!recorder || recorder.state !== "recording") return { ok: false };
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
      await updateDoc(sessionRef, {
        masterAudioUrl: audioUrl,
        masterAudioPath: objectPath,
        needsUpload: false,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, COLLECTIONS.packets, packetId), {
        [FIELDS.packets.latestAudioUrl]: audioUrl,
        [FIELDS.packets.latestAudioPath]: objectPath,
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

export async function transcribeOpenTape() {
  if (!state.judgeOpen.currentPacketId) return { ok: false, message: "Create a packet first." };
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

export async function transcribeOpenSegment({ sessionId } = {}) {
  if (!state.judgeOpen.currentPacketId) return { ok: false, message: "Create a packet first." };
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
    return { ok: false, message: "Create a packet first." };
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
  const response = await submitFn({
    packetId: state.judgeOpen.currentPacketId,
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
}

export function isOpenPacketEditable(packet) {
  if (!packet) return true;
  if (packet.locked) return false;
  const status = packet.status || STATUSES.draft;
  return status === STATUSES.draft || status === STATUSES.reopened;
}
