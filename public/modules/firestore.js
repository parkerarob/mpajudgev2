import {
  doc,
  getDoc,
  setDoc,
  collection,
  collectionGroup,
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
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase.js";
import { COLLECTIONS, JUDGE_POSITIONS } from "../state.js";
import { normalizeGradeBand } from "./utils.js";

export {
  doc,
  getDoc,
  setDoc,
  collection,
  collectionGroup,
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
  increment,
};

export async function fetchEnsembleGrade(eventId, ensembleId) {
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
      const data = entrySnap.data();
      const declared = normalizeGradeBand(data.declaredGradeLevel);
      const fromRepertoire = normalizeGradeBand(data.performanceGrade);
      return declared || fromRepertoire;
    }
  }
  const ensembleRef = doc(db, COLLECTIONS.ensembles, ensembleId);
  const ensembleSnap = await getDoc(ensembleRef);
  if (ensembleSnap.exists()) {
    return normalizeGradeBand(ensembleSnap.data().performanceGrade);
  }
  return null;
}

export async function fetchPacketSubmissions(eventId, ensembleId) {
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

export async function fetchEntryStatus(eventId, ensembleId) {
  if (!eventId || !ensembleId) return null;
  const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensembleId);
  const entrySnap = await getDoc(entryRef);
  if (!entrySnap.exists()) return null;
  return entrySnap.data()?.status || null;
}
