import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  fetchEnsembleGrade,
  fetchPacketSubmissions,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "./firestore.js";
import { COLLECTIONS, FIELDS, state } from "../state.js";
import { db, functions, storage } from "../firebase.js";
import { computePacketSummary } from "./judge-shared.js";
import { getDirectorNameForSchool } from "./director.js";
import { getSchoolNameById, normalizeEnsembleNameForSchool } from "./utils.js";

function sanitizeAudioFileName(name = "") {
  return String(name || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-120) || "manual_audio.wav";
}

async function readAudioDurationSec(file) {
  if (!file) return 0;
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const finish = (value) => {
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration || 0);
      finish(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };
    audio.onerror = () => finish(0);
    audio.src = objectUrl;
  });
}

async function uploadManualAudioBlob(path, file) {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type || "audio/wav" });
  const url = await getDownloadURL(storageRef);
  const durationSec = await readAudioDurationSec(file);
  return { url, durationSec };
}


export async function createEvent({
  name,
  eventMode = "live",
  startAtDate,
  endAtDate,
  registrationDeadlineDate,
}) {
  const deadlineDate = registrationDeadlineDate ||
    new Date(startAtDate.getFullYear(), startAtDate.getMonth() - 1, startAtDate.getDate());
  const normalizedMode = String(eventMode || "").trim().toLowerCase() === "rehearsal" ?
    "rehearsal" :
    "live";
  return addDoc(collection(db, COLLECTIONS.events), {
    name: name.trim(),
    isActive: false,
    eventMode: normalizedMode,
    readinessState: {
      preflight: null,
      steps: {},
      updatedAt: serverTimestamp(),
    },
    startAt: Timestamp.fromDate(startAtDate),
    endAt: Timestamp.fromDate(endAtDate),
    registrationDeadline: Timestamp.fromDate(deadlineDate),
    timezone: "America/New_York",
    createdAt: serverTimestamp(),
  });
}

export async function createScheduleEntry({
  eventId,
  performanceAtDate,
  schoolId,
  ensembleId,
  ensembleName,
}) {
  const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId);
  const normalizedEnsembleName = normalizeEnsembleNameForSchool({
    schoolName,
    ensembleName: ensembleName || ensembleId,
  });
  return addDoc(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule), {
    performanceAt: Timestamp.fromDate(performanceAtDate),
    schoolId,
    ensembleId,
    schoolName,
    ensembleName: normalizedEnsembleName,
    createdAt: serverTimestamp(),
  });
}

export async function saveAssignments({ eventId, stage1Uid, stage2Uid, stage3Uid, sightUid }) {
  const setAssignmentsFn = httpsCallable(functions, "setEventAssignments");
  const response = await setAssignmentsFn({
    eventId,
    stage1Uid,
    stage2Uid,
    stage3Uid,
    sightUid,
  });
  return response.data || {};
}

export async function runEventPreflight({ eventId }) {
  const fn = httpsCallable(functions, "runEventPreflight");
  const response = await fn({ eventId });
  return response.data || {};
}

export async function markReadinessStep({ eventId, stepKey, status, note = "" }) {
  const fn = httpsCallable(functions, "markReadinessStep");
  const response = await fn({ eventId, stepKey, status, note });
  return response.data || {};
}

export async function setReadinessWalkthrough({ eventId, status, note = "" }) {
  const fn = httpsCallable(functions, "setReadinessWalkthrough");
  const response = await fn({ eventId, status, note });
  return response.data || {};
}

export async function cleanupRehearsalArtifacts({ eventId }) {
  const fn = httpsCallable(functions, "cleanupRehearsalArtifacts");
  const response = await fn({ eventId });
  return response.data || {};
}

export async function saveSchool({ schoolId, name }) {
  const schoolRef = doc(db, COLLECTIONS.schools, schoolId);
  const existing = await getDoc(schoolRef);
  const payload = {
    name,
    updatedAt: serverTimestamp(),
  };
  if (!existing.exists()) {
    payload.createdAt = serverTimestamp();
  }
  return setDoc(schoolRef, payload, { merge: true });
}

export async function bulkImportSchools(lines) {
  const batch = writeBatch(db);
  let count = 0;
  lines.forEach(({ schoolId, name }) => {
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
    return { count: 0 };
  }
  await batch.commit();
  return { count };
}

export async function provisionUser(payload) {
  const provisionUserFn = httpsCallable(functions, "provisionUser");
  const response = await provisionUserFn(payload);
  return response.data || {};
}

export async function deleteUserAccount({ targetUid }) {
  const fn = httpsCallable(functions, "deleteUserAccount");
  const response = await fn({ targetUid });
  return response.data || {};
}

export async function assignDirectorSchool({ directorUid, schoolId }) {
  const fn = httpsCallable(functions, "assignDirectorSchool");
  const response = await fn({ directorUid, schoolId });
  return response.data || {};
}

export async function unassignDirectorSchool({ directorUid }) {
  const fn = httpsCallable(functions, "unassignDirectorSchool");
  const response = await fn({ directorUid });
  return response.data || {};
}

export async function renameEvent({ eventId, name }) {
  if (!eventId) throw new Error("eventId required");
  const eventRef = doc(db, COLLECTIONS.events, eventId);
  return updateDoc(eventRef, {
    name: String(name || "").trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEvent(eventId) {
  const deleteEventFn = httpsCallable(functions, "deleteEvent");
  return deleteEventFn({ eventId });
}

export async function setActiveEvent(eventId) {
  const targetId = String(eventId || "").trim();
  const eventsSnap = await getDocs(collection(db, COLLECTIONS.events));
  const batch = writeBatch(db);
  eventsSnap.forEach((eventDoc) => {
    batch.update(eventDoc.ref, {
      isActive: Boolean(targetId) && eventDoc.id === targetId,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export function watchEvents(callback) {
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
      return bTime - aTime;
    });
    callback?.(state.event.list);
  });
}

export function watchActiveEvent(callback) {
  if (state.subscriptions.activeEvent) state.subscriptions.activeEvent();
  const activeQuery = query(
    collection(db, COLLECTIONS.events),
    where(FIELDS.events.isActive, "==", true)
  );

  state.subscriptions.activeEvent = onSnapshot(activeQuery, (snapshot) => {
    state.event.active = snapshot.docs[0]
      ? { id: snapshot.docs[0].id, ...snapshot.docs[0].data() }
      : null;
    callback?.(state.event.active);
  });
}

export function watchAssignmentsForActiveEvent(callback) {
  if (state.subscriptions.assignments) state.subscriptions.assignments();
  if (!state.event.active?.id) {
    state.event.assignments = null;
    callback?.(null);
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
    callback?.(state.event.assignments);
  });
}

export function watchSchools(callback) {
  if (state.subscriptions.schools) state.subscriptions.schools();
  const schoolsQuery = query(collection(db, COLLECTIONS.schools), orderBy("name"));
  state.subscriptions.schools = onSnapshot(schoolsQuery, (snapshot) => {
    state.admin.schoolsList = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    callback?.(state.admin.schoolsList);
  });
}

export function watchJudges(callback) {
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
      const label = name && email ? `${name} - ${email}` : name || email || "Unknown judge";
      return { uid: docSnap.id, label };
    });
    judges.sort((a, b) => a.label.localeCompare(b.label));
    callback?.(judges);
  });
}

export function watchDirectors(callback) {
  if (state.subscriptions.directors) state.subscriptions.directors();
  const q = query(collection(db, COLLECTIONS.users));
  state.subscriptions.directors = onSnapshot(q, (snapshot) => {
    const directors = snapshot.docs
      .map((docSnap) => ({
        uid: docSnap.id,
        ...docSnap.data(),
      }))
      .filter((user) => user.role === "director" || user.roles?.director === true);
    directors.sort((a, b) => {
      const aLabel = (a.displayName || a.email || a.uid || "").toLowerCase();
      const bLabel = (b.displayName || b.email || b.uid || "").toLowerCase();
      return aLabel.localeCompare(bLabel);
    });
    callback?.(directors);
  });
}

export function watchUsers(callback) {
  if (state.subscriptions.users) state.subscriptions.users();
  const q = query(collection(db, COLLECTIONS.users));
  state.subscriptions.users = onSnapshot(q, (snapshot) => {
    const users = snapshot.docs.map((docSnap) => ({
      uid: docSnap.id,
      ...docSnap.data(),
    }));
    users.sort((a, b) => {
      const aLabel = (a.displayName || a.email || a.uid || "").toLowerCase();
      const bLabel = (b.displayName || b.email || b.uid || "").toLowerCase();
      return aLabel.localeCompare(bLabel);
    });
    callback?.(users);
  });
}

export function watchRoster(callback) {
  if (state.subscriptions.roster) state.subscriptions.roster();
  if (!state.event.active) {
    state.event.rosterEntries = [];
    callback?.(state.event.rosterEntries);
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
    callback?.(state.event.rosterEntries);
  });
}

export function watchScheduleEnsembles(schoolId, callback) {
  if (state.subscriptions.scheduleEnsembles) {
    state.subscriptions.scheduleEnsembles();
    state.subscriptions.scheduleEnsembles = null;
  }
  if (!schoolId) {
    callback?.([]);
    return;
  }
  const ensemblesRef = collection(db, COLLECTIONS.schools, schoolId, "ensembles");
  const ensemblesQuery = query(ensemblesRef, orderBy("name"));
  state.subscriptions.scheduleEnsembles = onSnapshot(ensemblesQuery, (snapshot) => {
    const ensembles = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    callback?.(ensembles);
  });
}

export function watchEntryStatus(entry, callback) {
  if (!state.event.active || !entry?.ensembleId) {
    callback?.("Entry: Unavailable");
    return null;
  }
  const entryRef = doc(
    db,
    COLLECTIONS.events,
    state.event.active.id,
    COLLECTIONS.entries,
    entry.ensembleId
  );
  return onSnapshot(entryRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback?.("Entry: Missing");
      return;
    }
    const status = snapshot.data()?.status || "draft";
    const label = status === "ready" ? "Entry: Ready" : "Entry: Draft";
    callback?.(label);
  });
}


export async function updateScheduleEntryTime({ eventId, entryId, nextDate }) {
  return updateDoc(
    doc(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule, entryId),
    {
      performanceAt: Timestamp.fromDate(nextDate),
      updatedAt: serverTimestamp(),
    }
  );
}

export async function updateEventSchedulerFields({
  eventId,
  firstPerformanceAt,
  scheduleBreaks,
  scheduleDayBreaks,
}) {
  const eventRef = doc(db, COLLECTIONS.events, eventId);
  const updates = {};
  if (firstPerformanceAt !== undefined) {
    updates[FIELDS.events.firstPerformanceAt] = firstPerformanceAt
      ? Timestamp.fromDate(firstPerformanceAt)
      : null;
  }
  if (scheduleBreaks !== undefined) {
    updates[FIELDS.events.scheduleBreaks] = Array.isArray(scheduleBreaks)
      ? scheduleBreaks
      : [];
  }
  if (scheduleDayBreaks !== undefined) {
    const converted = {};
    if (scheduleDayBreaks && typeof scheduleDayBreaks === "object") {
      for (const [key, val] of Object.entries(scheduleDayBreaks)) {
        converted[key] = val instanceof Date ? Timestamp.fromDate(val) : val;
      }
    }
    updates[FIELDS.events.scheduleDayBreaks] = converted;
  }
  if (Object.keys(updates).length === 0) return;
  return updateDoc(eventRef, { ...updates, updatedAt: serverTimestamp() });
}

export async function deleteScheduleEntry({ eventId, entryId }) {
  return deleteDoc(doc(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule, entryId));
}

/**
 * Aggregate lunch totals by school for the event (from director entries).
 * @param {string} eventId
 * @returns {Promise<Array<{ schoolId: string, schoolName: string, cheese: number, pepperoni: number, total: number }>>}
 */
export async function getLunchTotalsBySchool(eventId) {
  if (!eventId) return [];
  const entriesSnap = await getDocs(
    collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries)
  );
  const bySchool = new Map();
  entriesSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const schoolId = data.schoolId || "";
    if (!schoolId) return;
    const lunch = data.lunchOrder || {};
    const cheese = Number(lunch.cheeseQty) || 0;
    const pepperoni = Number(lunch.pepperoniQty) || 0;
    const prev = bySchool.get(schoolId) || { cheese: 0, pepperoni: 0 };
    prev.cheese += cheese;
    prev.pepperoni += pepperoni;
    bySchool.set(schoolId, prev);
  });
  const schoolsList = state.admin.schoolsList || [];
  return Array.from(bySchool.entries())
    .map(([schoolId, counts]) => ({
      schoolId,
      schoolName: getSchoolNameById(schoolsList, schoolId) || schoolId,
      cheese: counts.cheese,
      pepperoni: counts.pepperoni,
      total: counts.cheese + counts.pepperoni,
    }))
    .sort((a, b) => (a.schoolName || "").localeCompare(b.schoolName || ""));
}

export async function getPacketData({ eventId, entry }) {
  const [grade, directorName, submissions] = await Promise.all([
    fetchEnsembleGrade(eventId, entry.ensembleId),
    getDirectorNameForSchool(entry.schoolId),
    fetchPacketSubmissions(eventId, entry.ensembleId),
  ]);
  const summary = computePacketSummary(grade, submissions);
  return { grade, directorName, submissions, summary };
}

export async function releasePacket({ eventId, ensembleId }) {
  const releasePacketFn = httpsCallable(functions, "releasePacket");
  return releasePacketFn({ eventId, ensembleId });
}

export async function unreleasePacket({ eventId, ensembleId }) {
  const unreleasePacketFn = httpsCallable(functions, "unreleasePacket");
  return unreleasePacketFn({ eventId, ensembleId });
}

export async function releaseMockPacketForAshleyTesting({ schoolId = "", ensembleId = "", grade = "IV" } = {}) {
  const fn = httpsCallable(functions, "releaseMockPacketForAshleyTesting");
  const response = await fn({ schoolId, ensembleId, grade });
  return response?.data || {};
}

export async function unlockSubmission({ eventId, ensembleId, judgePosition }) {
  const unlockSubmissionFn = httpsCallable(functions, "unlockSubmission");
  return unlockSubmissionFn({ eventId, ensembleId, judgePosition });
}

export async function lockSubmission({ eventId, ensembleId, judgePosition }) {
  const lockSubmissionFn = httpsCallable(functions, "lockSubmission");
  return lockSubmissionFn({ eventId, ensembleId, judgePosition });
}

export async function lockOpenPacket({ packetId }) {
  const lockFn = httpsCallable(functions, "lockPacket");
  return lockFn({ packetId });
}

export async function unlockOpenPacket({ packetId }) {
  const unlockFn = httpsCallable(functions, "unlockPacket");
  return unlockFn({ packetId });
}

export async function releaseOpenPacket({ packetId }) {
  const releaseFn = httpsCallable(functions, "releaseOpenPacket");
  return releaseFn({ packetId });
}

export async function unreleaseOpenPacket({ packetId }) {
  const unreleaseFn = httpsCallable(functions, "unreleaseOpenPacket");
  return unreleaseFn({ packetId });
}

export async function linkOpenPacketToEnsemble({ packetId, schoolId, ensembleId }) {
  const linkFn = httpsCallable(functions, "linkOpenPacketToEnsemble");
  return linkFn({ packetId, schoolId, ensembleId });
}

export async function setOpenPacketJudgePosition({ packetId, judgePosition, assignmentEventId }) {
  const setFn = httpsCallable(functions, "setOpenPacketJudgePosition");
  return setFn({ packetId, judgePosition, assignmentEventId });
}

export async function deleteOpenPacket({ packetId }) {
  const deleteFn = httpsCallable(functions, "deleteOpenPacket");
  return deleteFn({ packetId });
}

export async function deleteScheduledPacket({ eventId, ensembleId }) {
  const deleteFn = httpsCallable(functions, "deleteScheduledPacket");
  const response = await deleteFn({ eventId, ensembleId });
  return response.data || {};
}

export async function deleteAllUnreleasedPackets() {
  const deleteFn = httpsCallable(functions, "deleteAllUnreleasedPackets");
  const response = await deleteFn({});
  return response.data || {};
}

export async function cleanupTestArtifacts({ dryRun = true } = {}) {
  const fn = httpsCallable(functions, "cleanupTestArtifacts");
  const response = await fn({ dryRun: dryRun !== false });
  return response?.data || {};
}

export async function attachManualAudioToScheduledPacket({
  eventId,
  ensembleId,
  judgePosition,
  file,
} = {}) {
  if (!eventId || !ensembleId || !judgePosition || !file) {
    return { ok: false, message: "eventId, ensembleId, judgePosition, and file are required." };
  }
  const uid = state.auth.currentUser?.uid || "admin";
  const submissionId = `${eventId}_${ensembleId}_${judgePosition}`;
  const fileName = `${Date.now()}_${sanitizeAudioFileName(file.name || "manual_audio.wav")}`;
  const path = `audio/${uid}/${submissionId}/${fileName}`;
  const upload = await uploadManualAudioBlob(path, file);
  const fn = httpsCallable(functions, "attachManualPacketAudio");
  const response = await fn({
    targetType: "scheduled",
    eventId,
    ensembleId,
    judgePosition,
    audioPath: path,
    audioUrl: upload.url,
    durationSec: upload.durationSec,
  });
  return { ok: true, ...(response?.data || {}), audioUrl: upload.url };
}

export async function attachManualAudioToOpenPacket({ packetId, file } = {}) {
  if (!packetId || !file) {
    return { ok: false, message: "packetId and file are required." };
  }
  const uid = state.auth.currentUser?.uid || "admin";
  const fileName = `${Date.now()}_${sanitizeAudioFileName(file.name || "manual_audio.wav")}`;
  const path = `packet_audio/${uid}/${packetId}/manual/${fileName}`;
  const upload = await uploadManualAudioBlob(path, file);
  const fn = httpsCallable(functions, "attachManualPacketAudio");
  const response = await fn({
    targetType: "open",
    packetId,
    audioPath: path,
    audioUrl: upload.url,
    durationSec: upload.durationSec,
  });
  return { ok: true, ...(response?.data || {}), audioUrl: upload.url };
}

export async function createAudioOnlyResultFromFile({
  eventId,
  schoolId,
  ensembleId,
  ensembleName,
  judgePosition = "",
  mode = "official",
  file,
} = {}) {
  if (!eventId || !schoolId || !ensembleId || !file) {
    return { ok: false, message: "eventId, schoolId, ensembleId, and file are required." };
  }
  const fileName = `${Date.now()}_${sanitizeAudioFileName(file.name || "audio_only.wav")}`;
  const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const path = `audio_results/${eventId}/${ensembleId}/${tempId}/${fileName}`;
  const upload = await uploadManualAudioBlob(path, file);
  const fn = httpsCallable(functions, "createAudioOnlyResult");
  const response = await fn({
    eventId,
    schoolId,
    ensembleId,
    ensembleName: ensembleName || ensembleId,
    judgePosition,
    mode: mode === "practice" ? "practice" : "official",
    audioPath: path,
    audioUrl: upload.url,
    durationSec: upload.durationSec,
  });
  return { ok: true, ...(response?.data || {}), audioUrl: upload.url };
}

export async function releaseAudioOnlyResult({ audioResultId } = {}) {
  const fn = httpsCallable(functions, "releaseAudioOnlyResult");
  const response = await fn({ audioResultId });
  return response?.data || {};
}

export async function unreleaseAudioOnlyResult({ audioResultId } = {}) {
  const fn = httpsCallable(functions, "unreleaseAudioOnlyResult");
  const response = await fn({ audioResultId });
  return response?.data || {};
}

export async function repairManualAudioOverrides({ dryRun = true } = {}) {
  const fn = httpsCallable(functions, "repairManualAudioOverrides");
  const response = await fn({ dryRun: dryRun !== false });
  return response?.data || {};
}

export async function deleteSchool({ schoolId }) {
  const deleteFn = httpsCallable(functions, "deleteSchool");
  return deleteFn({ schoolId });
}

export async function deleteEnsemble({ schoolId, ensembleId, force = false }) {
  const deleteFn = httpsCallable(functions, "deleteEnsemble");
  const response = await deleteFn({ schoolId, ensembleId, force: Boolean(force) });
  return response.data || {};
}

export async function fetchRegisteredEnsembles(eventId, schoolId = null) {
  if (!eventId) return [];
  const entriesRef = collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries);
  const entriesQuery = schoolId
    ? query(entriesRef, where("schoolId", "==", schoolId))
    : entriesRef;
  const snap = await getDocs(entriesQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchScheduleEntries(eventId, schoolId = null) {
  if (!eventId) return [];
  const scheduleRef = collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule);
  const scheduleQuery = schoolId
    ? query(scheduleRef, where("schoolId", "==", schoolId))
    : query(scheduleRef, orderBy("performanceAt", "asc"));
  const snap = await getDocs(scheduleQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchSchoolRegistrations(eventId) {
  if (!eventId) return [];
  const snap = await getDocs(
    collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schoolRegistrations)
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateSchoolRegistration(eventId, schoolId, fields) {
  if (!eventId || !schoolId) return;
  const ref = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.schoolRegistrations, schoolId);
  const snap = await getDoc(ref);
  const payload = { ...fields, updatedAt: serverTimestamp() };
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, { schoolId, eventId, ...payload, createdAt: serverTimestamp() }, { merge: true });
  }
}

export async function updateEntryCheckinFields(eventId, ensembleId, fields) {
  if (!eventId || !ensembleId) return;
  const ref = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId);
  const snap = await getDoc(ref);
  const payload = { ...fields, updatedAt: serverTimestamp() };
  if (snap.exists()) {
    return updateDoc(ref, payload);
  }
  return setDoc(
    ref,
    {
      eventId,
      ensembleId,
      ...payload,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}
