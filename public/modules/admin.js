import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  fetchEnsembleGrade,
  fetchPacketSubmissions,
  getDocs,
  increment,
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
import { db, functions } from "../firebase.js";
import { computePacketSummary } from "./judge-shared.js";
import { getDirectorNameForSchool } from "./director.js";
import { getSchoolNameById } from "./utils.js";


export async function createEvent({ name, startAtDate, endAtDate }) {
  return addDoc(collection(db, COLLECTIONS.events), {
    name: name.trim(),
    isActive: false,
    startAt: Timestamp.fromDate(startAtDate),
    endAt: Timestamp.fromDate(endAtDate),
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
  const perfTs = Timestamp.fromDate(performanceAtDate);
  return addDoc(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule), {
    performanceAt: perfTs,
    holdingAt: perfTs,
    warmupAt: perfTs,
    sightReadingAt: null,
    sortOrder: Math.trunc(performanceAtDate.getTime() / 1000),
    schoolId,
    ensembleId,
    schoolName: getSchoolNameById(state.admin.schoolsList, schoolId),
    ensembleName: ensembleName || ensembleId,
    createdAt: serverTimestamp(),
  });
}

export async function saveAssignments({ eventId, stage1Uid, stage2Uid, stage3Uid, sightUid }) {
  const assignmentsRef = doc(
    db,
    COLLECTIONS.events,
    eventId,
    COLLECTIONS.assignments,
    "positions"
  );
  return setDoc(
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
  const setActiveEventFn = httpsCallable(functions, "setActiveEvent");
  const targetId = String(eventId || "").trim();
  return setActiveEventFn({ eventId: targetId });
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
      return aTime - bTime;
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

export async function deleteScheduleEntry({ eventId, entryId }) {
  return deleteDoc(doc(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule, entryId));
}

export async function createEventScheduleRow({
  eventId,
  schoolId,
  ensembleId,
  ensembleName,
  sortOrder,
  holdingAtDate,
  warmupAtDate,
  performanceAtDate,
  sightReadingAtDate = null,
}) {
  if (!eventId) throw new Error("eventId required");
  if (!schoolId || !ensembleId) throw new Error("School and ensemble are required.");
  if (!(holdingAtDate instanceof Date) || Number.isNaN(holdingAtDate.getTime())) {
    throw new Error("Holding time is required.");
  }
  if (!(warmupAtDate instanceof Date) || Number.isNaN(warmupAtDate.getTime())) {
    throw new Error("Warm-up time is required.");
  }
  if (!(performanceAtDate instanceof Date) || Number.isNaN(performanceAtDate.getTime())) {
    throw new Error("Performance time is required.");
  }
  const orderValue = Number(sortOrder);
  return addDoc(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule), {
    schoolId,
    schoolName: getSchoolNameById(state.admin.schoolsList, schoolId),
    ensembleId,
    ensembleName: ensembleName || ensembleId,
    sortOrder: Number.isFinite(orderValue) && orderValue > 0 ? Math.trunc(orderValue) : 9999,
    holdingAt: Timestamp.fromDate(holdingAtDate),
    warmupAt: Timestamp.fromDate(warmupAtDate),
    performanceAt: Timestamp.fromDate(performanceAtDate),
    sightReadingAt:
      sightReadingAtDate instanceof Date && !Number.isNaN(sightReadingAtDate.getTime())
        ? Timestamp.fromDate(sightReadingAtDate)
        : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateEventScheduleRow({
  eventId,
  rowId,
  sortOrder,
  holdingAtDate,
  warmupAtDate,
  performanceAtDate,
  sightReadingAtDate,
}) {
  if (!eventId || !rowId) throw new Error("Missing schedule row.");
  const patch = {
    updatedAt: serverTimestamp(),
  };
  if (sortOrder !== undefined) {
    const orderValue = Number(sortOrder);
    patch.sortOrder = Number.isFinite(orderValue) ? Math.trunc(orderValue) : 9999;
  }
  if (holdingAtDate !== undefined) {
    patch.holdingAt =
      holdingAtDate instanceof Date && !Number.isNaN(holdingAtDate.getTime())
        ? Timestamp.fromDate(holdingAtDate)
        : null;
  }
  if (warmupAtDate !== undefined) {
    patch.warmupAt =
      warmupAtDate instanceof Date && !Number.isNaN(warmupAtDate.getTime())
        ? Timestamp.fromDate(warmupAtDate)
        : null;
  }
  if (performanceAtDate !== undefined) {
    patch.performanceAt =
      performanceAtDate instanceof Date && !Number.isNaN(performanceAtDate.getTime())
        ? Timestamp.fromDate(performanceAtDate)
        : null;
  }
  if (sightReadingAtDate !== undefined) {
    patch.sightReadingAt =
      sightReadingAtDate instanceof Date && !Number.isNaN(sightReadingAtDate.getTime())
        ? Timestamp.fromDate(sightReadingAtDate)
        : null;
  }
  return updateDoc(doc(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule, rowId), patch);
}

export async function deleteEventScheduleRow({ eventId, rowId }) {
  if (!eventId || !rowId) throw new Error("Missing schedule row.");
  return deleteDoc(doc(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule, rowId));
}

export function watchEventScheduleRows(eventId, callback) {
  if (!eventId) {
    callback?.([]);
    return () => {};
  }
  const q = query(
    collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule),
    orderBy("performanceAt", "asc")
  );
  return onSnapshot(q, (snapshot) => {
    const rows = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aSort = Number(a.sortOrder || 9999);
        const bSort = Number(b.sortOrder || 9999);
        if (aSort !== bSort) return aSort - bSort;
        const aTime = a.performanceAt?.toMillis ? a.performanceAt.toMillis() : 0;
        const bTime = b.performanceAt?.toMillis ? b.performanceAt.toMillis() : 0;
        return aTime - bTime;
      });
    callback?.(rows);
  });
}

export function watchPublishedEventScheduleRows(eventId, callback) {
  if (!eventId) {
    callback?.([]);
    return () => {};
  }
  const q = query(
    collection(db, COLLECTIONS.events, eventId, "publishedSchedule"),
    orderBy("performanceAt", "asc")
  );
  return onSnapshot(q, (snapshot) => {
    const rows = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aSort = Number(a.sortOrder || 9999);
        const bSort = Number(b.sortOrder || 9999);
        if (aSort !== bSort) return aSort - bSort;
        const aTime = a.performanceAt?.toMillis ? a.performanceAt.toMillis() : 0;
        const bTime = b.performanceAt?.toMillis ? b.performanceAt.toMillis() : 0;
        return aTime - bTime;
      });
    callback?.(rows);
  });
}

export async function publishEventSchedule({ eventId }) {
  if (!eventId) throw new Error("eventId required");
  const eventRef = doc(db, COLLECTIONS.events, eventId);
  const draftSnap = await getDocs(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule));
  const rows = draftSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  if (!rows.length) {
    throw new Error("Add at least one schedule row before publishing.");
  }
  rows.forEach((row) => {
    if (!row.schoolId || !row.ensembleId) throw new Error("Every schedule row needs school and ensemble.");
    if (!row.holdingAt) throw new Error("Every row needs holding time.");
    if (!row.warmupAt) throw new Error("Every row needs warm-up time.");
    if (!row.performanceAt) throw new Error("Every row needs performance time.");
  });
  const duplicateKeys = new Set();
  rows.forEach((row) => {
    const key = `${row.schoolId || ""}::${row.ensembleId || ""}`;
    if (duplicateKeys.has(key)) {
      throw new Error("Duplicate school/ensemble schedule rows found. Remove duplicates before publishing.");
    }
    duplicateKeys.add(key);
  });

  const existingPublished = await getDocs(collection(db, COLLECTIONS.events, eventId, "publishedSchedule"));
  const eventSnap = await getDoc(eventRef);
  const currentVersion = Number(eventSnap.data()?.schedulePublishedVersion || 0);
  const nextVersion = currentVersion + 1;
  const batch = writeBatch(db);
  existingPublished.docs.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  rows.forEach((row) => {
    const publishedRef = doc(db, COLLECTIONS.events, eventId, "publishedSchedule", row.id);
    batch.set(publishedRef, {
      ...row,
      publishedVersion: nextVersion,
      publishedAt: serverTimestamp(),
    });
  });
  batch.update(eventRef, {
    schedulePublished: true,
    schedulePublishedAt: serverTimestamp(),
    schedulePublishedVersion: increment(1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function unpublishEventSchedule({ eventId }) {
  if (!eventId) throw new Error("eventId required");
  const publishedSnap = await getDocs(collection(db, COLLECTIONS.events, eventId, "publishedSchedule"));
  const eventRef = doc(db, COLLECTIONS.events, eventId);
  const batch = writeBatch(db);
  publishedSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  batch.set(
    eventRef,
    {
      schedulePublished: false,
      schedulePublishedAt: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}

export async function loadAdminDutiesEntriesForSchool({ eventId, schoolId }) {
  if (!eventId || !schoolId) return [];
  const entriesQuery = query(
    collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries),
    where("schoolId", "==", schoolId)
  );
  const snapshot = await getDocs(entriesQuery);
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

export async function loadAdminDutiesEntriesForEvent({ eventId }) {
  if (!eventId) return [];
  const snapshot = await getDocs(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries));
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

export async function saveAdminDutiesForEnsemble({
  eventId,
  schoolId,
  ensembleId,
  adminDuties,
}) {
  if (!eventId || !schoolId || !ensembleId) {
    throw new Error("Missing event, school, or ensemble.");
  }
  const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId);
  return setDoc(
    entryRef,
    {
      eventId,
      schoolId,
      ensembleId,
      adminDuties: adminDuties || {},
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
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

export async function unlockSubmission({ eventId, ensembleId, judgePosition }) {
  const unlockSubmissionFn = httpsCallable(functions, "unlockSubmission");
  return unlockSubmissionFn({ eventId, ensembleId, judgePosition });
}

export async function lockSubmission({ eventId, ensembleId, judgePosition }) {
  const lockSubmissionFn = httpsCallable(functions, "lockSubmission");
  return lockSubmissionFn({ eventId, ensembleId, judgePosition });
}

export function watchOpenPacketsAdmin(callback) {
  if (state.subscriptions.openPacketsAdmin) state.subscriptions.openPacketsAdmin();
  const packetsQuery = query(
    collection(db, COLLECTIONS.packets),
    orderBy(FIELDS.packets.updatedAt, "desc")
  );
  state.subscriptions.openPacketsAdmin = onSnapshot(packetsQuery, (snapshot) => {
    const packets = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    callback?.(packets);
  });
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

export async function deleteSchool({ schoolId }) {
  const deleteFn = httpsCallable(functions, "deleteSchool");
  return deleteFn({ schoolId });
}
