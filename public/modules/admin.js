import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
import { db, functions } from "../firebase.js";
import { computePacketSummary } from "./judge.js";
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
  return addDoc(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule), {
    performanceAt: Timestamp.fromDate(performanceAtDate),
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
  return setDoc(
    doc(db, COLLECTIONS.schools, schoolId),
    {
      name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
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

export async function deleteEvent(eventId) {
  const deleteEventFn = httpsCallable(functions, "deleteEvent");
  return deleteEventFn({ eventId });
}

export async function setActiveEvent(eventId) {
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
      const label = name && email ? `${name} — ${email}` : name || email || "Unknown judge";
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

export async function linkOpenPacketToEnsemble({ packetId, schoolId, ensembleId }) {
  const linkFn = httpsCallable(functions, "linkOpenPacketToEnsemble");
  return linkFn({ packetId, schoolId, ensembleId });
}
