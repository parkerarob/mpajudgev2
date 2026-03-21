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
  getDocsFromServer,
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
  getDocsFromServer,
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
      const fromRepertoire = normalizeGradeBand(data.performanceGrade);
      const declared = normalizeGradeBand(data.declaredGradeLevel);
      return fromRepertoire || declared;
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
  const normalizePacketSubmission = ({ official = null, submission = null } = {}) => {
    if (!official && !submission) return null;
    if (!official) {
      return { ...submission, sourceType: "submission" };
    }
    const officialStatus = String(official.status || "").trim().toLowerCase();
    return {
      ...(submission || {}),
      ...official,
      locked: true,
      status: officialStatus === "released" ? "released" : "submitted",
      sourceType: "officialAssessment",
      commentsOnly: Boolean(official.commentsOnly || submission?.commentsOnly),
      releaseEligible: official.releaseEligible !== false,
      canonicalAudioUrl:
        official.audioUrl ||
        submission?.canonicalAudioUrl ||
        submission?.audioUrl ||
        "",
      canonicalAudioPath:
        official.audioPath ||
        submission?.canonicalAudioPath ||
        submission?.audioPath ||
        "",
      canonicalAudioDurationSec: Number(
        official.audioDurationSec ||
          submission?.canonicalAudioDurationSec ||
          submission?.audioDurationSec ||
          0
      ),
      audioSegments: Array.isArray(official.audioSegments) && official.audioSegments.length
        ? official.audioSegments
        : Array.isArray(submission?.audioSegments)
          ? submission.audioSegments
          : [],
      supplementalAudioUrl: String(
        official.supplementalAudioUrl ||
          submission?.supplementalAudioUrl ||
          ""
      ),
      supplementalAudioPath: String(
        official.supplementalAudioPath ||
          submission?.supplementalAudioPath ||
          ""
      ),
      supplementalAudioDurationSec: Number(
        official.supplementalAudioDurationSec ||
          submission?.supplementalAudioDurationSec ||
          0
      ),
    };
  };
  const submissions = {};
  await Promise.all(
    positions.map(async (position) => {
      const assessmentId = `${eventId}_${ensembleId}_${position}`;
      const officialRef = doc(db, COLLECTIONS.officialAssessments, assessmentId);
      const submissionRef = doc(db, COLLECTIONS.submissions, assessmentId);
      const [officialSnap, submissionSnap] = await Promise.all([
        getDoc(officialRef),
        getDoc(submissionRef),
      ]);
      submissions[position] = normalizePacketSubmission({
        official: officialSnap.exists() ? { id: officialSnap.id, ...officialSnap.data() } : null,
        submission: submissionSnap.exists() ? { id: submissionSnap.id, ...submissionSnap.data() } : null,
      });
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
