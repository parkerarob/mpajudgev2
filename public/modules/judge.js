import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "./firestore.js";
import {
  COLLECTIONS,
  FIELDS,
  FORM_TYPES,
  JUDGE_POSITIONS,
  STATUSES,
  state,
} from "../state.js";
import { db, functions, storage } from "../firebase.js";
import { blobToBase64 } from "./utils.js";
export {
  calculateCaptionTotal,
  computeFinalRating,
  computeOverallPacketRating,
  computePacketSummary,
} from "./judge-shared.js";
import {
  calculateCaptionTotal,
  computeFinalRating,
} from "./judge-shared.js";

export function markJudgeDirty() {
  state.judge.draftDirty = true;
  state.judge.draftVersion += 1;
}

export function hasJudgeUnsavedChanges() {
  return state.judge.draftDirty;
}

export function resetJudgeDraftState(submissionKey = null) {
  state.judge.draftDirty = false;
  state.judge.draftVersion = 0;
  state.judge.draftSubmissionKey = submissionKey;
}

export function getJudgeDraftSubmissionKey() {
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position) return null;
  return `${state.event.active.id}_${state.judge.selectedRosterEntry.ensembleId}_${state.judge.position}`;
}

export function resetJudgeState() {
  state.judge.position = null;
  state.judge.formType = null;
  state.judge.selectedRosterEntry = null;
  state.judge.audioBlob = null;
  state.judge.audioDurationSec = 0;
  state.judge.currentSubmissionHasAudio = false;
  state.judge.transcriptText = "";
  state.judge.captions = {};
  resetJudgeDraftState(null);
  return {
    submissionHint: "Select an ensemble to begin.",
  };
}

export async function loadJudgeEntrySummary(entry) {
  if (!state.event.active || !entry?.ensembleId) {
    return { summary: "" };
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
      return { summary: "" };
    }
    const defaults = buildDefaultEntry({
      eventId: state.event.active.id,
      schoolId: entry.schoolId || "",
      ensembleId: entry.ensembleId,
      createdByUid: "",
    });
    const normalized = normalizeEntryData(entrySnap.data(), defaults);
    return { summaryData: normalized };
  } catch (error) {
    console.error("Failed to load entry summary", error);
    return { summary: "" };
  }
}

export function isSubmissionComplete(submission) {
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

export function resetTestState() {
  state.judge.testAudioBlob = null;
  state.judge.testRecordingChunks = [];
  state.judge.testTranscriptText = "";
  state.judge.testCaptions = {};
  return { ok: true };
}

export function setTestMode(next) {
  state.judge.isTestMode = next;
  if (next) {
    state.judge.previousFormType = state.judge.formType;
    state.judge.formType = state.judge.testFormType;
  } else {
    state.judge.formType = state.judge.previousFormType;
  }
  return {
    isTestMode: next,
    hasSelection: Boolean(state.judge.selectedRosterEntry),
  };
}

async function transcribeAudioBlobForTranscript(blob) {
  if (!blob) return { ok: false, message: "Record audio before transcribing." };
  try {
    const base64 = await blobToBase64(blob);
    const transcribeFn = httpsCallable(functions, "transcribeTestAudio");
    const response = await transcribeFn({
      audioBase64: base64,
      mimeType: blob.type || "audio/webm",
    });
    return { ok: true, transcript: response.data?.transcript || "" };
  } catch (error) {
    const message = error?.message || "Transcription failed.";
    return { ok: false, message, error };
  }
}

export async function transcribeSubmissionAudio() {
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "judge") {
    return { ok: false, message: "Sign in as a judge to transcribe." };
  }
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position) {
    return { ok: false, message: "Select an ensemble to transcribe." };
  }
  const hasLocalAudio = Boolean(state.judge.audioBlob);
  if (!hasLocalAudio && !state.judge.currentSubmissionHasAudio) {
    return { ok: false, message: "Record audio before transcribing." };
  }
  const eventId = state.event.active.id;
  const ensembleId = state.judge.selectedRosterEntry.ensembleId;
  const submissionId = `${eventId}_${ensembleId}_${state.judge.position}`;

  if (hasLocalAudio) {
    const audioRef = ref(
      storage,
      `audio/${state.auth.currentUser.uid}/${submissionId}/recording.webm`
    );
    await uploadBytes(audioRef, state.judge.audioBlob, {
      contentType: "audio/webm",
    });
    const audioUrl = await getDownloadURL(audioRef);
    state.judge.currentSubmissionHasAudio = true;
    try {
      const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
      await setDoc(
        submissionRef,
        {
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
          [FIELDS.submissions.eventId]: eventId,
          [FIELDS.submissions.ensembleId]: ensembleId,
          [FIELDS.submissions.judgePosition]: state.judge.position,
          [FIELDS.submissions.formType]: state.judge.formType,
          [FIELDS.submissions.audioUrl]: audioUrl,
          [FIELDS.submissions.audioDurationSec]: state.judge.audioDurationSec,
          [FIELDS.submissions.updatedAt]: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.warn("Unable to update draft submission before transcription", error);
    }
  }

  const transcribeFn = httpsCallable(functions, "transcribeSubmissionAudio");
  try {
    const response = await transcribeFn({
      eventId,
      ensembleId,
      judgePosition: state.judge.position,
    });
    return { ok: true, transcript: response.data?.transcript || "" };
  } catch (error) {
    const message = error?.message || "Transcription failed.";
    const code = String(error?.code || "");
    const text = String(error?.message || "");
    if (hasLocalAudio && (code.includes("not-found") || text.includes("Submission not found"))) {
      return transcribeAudioBlobForTranscript(state.judge.audioBlob);
    }
    return { ok: false, message, error };
  }
}

export async function transcribeTestAudio() {
  return transcribeAudioBlobForTranscript(state.judge.testAudioBlob);
}

export async function draftCaptionsFromTranscript({ transcript, formType }) {
  if (!transcript || !transcript.trim()) {
    return { ok: false, message: "Transcript is empty." };
  }
  if (!formType) {
    return { ok: false, message: "Select a form type first." };
  }
  try {
    const parseFn = httpsCallable(functions, "parseTranscript");
    const response = await parseFn({ transcript, formType });
    return { ok: true, captions: response.data?.captions || {}, formType };
  } catch (error) {
    const message = error?.message || "Caption drafting failed.";
    return { ok: false, message, error };
  }
}

export function watchReadyEntries(callback) {
  if (state.subscriptions.readyEntries) state.subscriptions.readyEntries();
  if (!state.event.active) {
    state.event.readyEnsembles = new Set();
    callback?.(state.event.readyEnsembles);
    return;
  }
  const readyQuery = query(
    collection(db, COLLECTIONS.events, state.event.active.id, COLLECTIONS.entries),
    where("status", "==", "ready")
  );
  state.subscriptions.readyEntries = onSnapshot(readyQuery, (snapshot) => {
    state.event.readyEnsembles = new Set(snapshot.docs.map((docSnap) => docSnap.id));
    callback?.(state.event.readyEnsembles);
  });
}

export function watchCurrentSubmission(callback) {
  if (state.subscriptions.judgeSubmission) {
    state.subscriptions.judgeSubmission();
    state.subscriptions.judgeSubmission = null;
  }
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position) {
    callback?.(null);
    return;
  }
  const submissionId = `${state.event.active.id}_${state.judge.selectedRosterEntry.ensembleId}_${state.judge.position}`;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  state.subscriptions.judgeSubmission = onSnapshot(submissionRef, (snapshot) => {
    const submission = snapshot.exists() ? snapshot.data() : null;
    state.judge.currentSubmissionHasAudio = Boolean(submission?.audioUrl);
    callback?.(submission);
  });
}

export async function selectRosterEntry(entry) {
  state.judge.selectedRosterEntry = entry;
  const result = {
    submissionHint: `Selected ensemble ${entry.ensembleId}.`,
    summary: await loadJudgeEntrySummary(entry),
  };

  if (!state.event.active || !state.judge.position || !state.auth.currentUser) {
    return result;
  }

  const submissionId = `${state.event.active.id}_${entry.ensembleId}_${state.judge.position}`;
  resetJudgeDraftState(submissionId);
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  const submissionSnap = await getDoc(submissionRef);
  if (submissionSnap.exists() && submissionSnap.data().locked) {
    result.submissionHint = "Submission already locked. Admin must unlock for edits.";
    result.submitDisabled = true;
  } else {
    result.submitDisabled = false;
  }
  result.submission = submissionSnap.exists() ? submissionSnap.data() : null;
  state.judge.currentSubmissionHasAudio =
    submissionSnap.exists() && Boolean(submissionSnap.data().audioUrl);
  result.currentSubmissionHasAudio = state.judge.currentSubmissionHasAudio;
  return result;
}

export async function handleSubmit(event) {
  event?.preventDefault?.();
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "judge") return;
  if (state.judge.isTestMode) {
    return { ok: false, message: "Test mode active. Submissions are disabled." };
  }
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position || !state.judge.formType) {
    return { ok: false, message: "Missing active event, roster selection, or assignment." };
  }

  const submissionId = `${state.event.active.id}_${state.judge.selectedRosterEntry.ensembleId}_${state.judge.position}`;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  const submissionSnap = await getDoc(submissionRef);
  if (submissionSnap.exists() && submissionSnap.data().locked) {
    return { ok: false, message: "Submission locked. Admin must unlock." };
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
    [FIELDS.submissions.transcript]: state.judge.transcriptText.trim(),
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
    /* no-op */
  } else {
    /* no-op */
  }
  state.judge.currentSubmissionHasAudio = Boolean(
    audioUrl || (submissionSnap.exists() && submissionSnap.data().audioUrl)
  );
  const submittedSnap = await getDoc(submissionRef);
  resetJudgeDraftState(submissionId);
  return {
    ok: true,
    locked: Boolean(nextLocked),
    submission: submittedSnap.exists() ? submittedSnap.data() : null,
    message: nextLocked
      ? "Submitted and locked."
      : "Saved (unlocked). Admin must lock when finalized.",
  };
}

export function watchAssignments(callback) {
  if (state.subscriptions.assignments) state.subscriptions.assignments();
  if (!state.event.active) {
    state.event.assignments = null;
    state.judge.position = null;
    state.judge.formType = null;
    callback?.({
      position: null,
      formType: null,
      assignments: null,
    });
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
    callback?.({
      position: state.judge.position,
      formType: state.judge.formType,
      assignments: state.event.assignments,
    });
  });
}

export function detectJudgePosition(assignmentsDoc, uid) {
  if (!assignmentsDoc) return null;
  if (assignmentsDoc.stage1Uid === uid) return JUDGE_POSITIONS.stage1;
  if (assignmentsDoc.stage2Uid === uid) return JUDGE_POSITIONS.stage2;
  if (assignmentsDoc.stage3Uid === uid) return JUDGE_POSITIONS.stage3;
  if (assignmentsDoc.sightUid === uid) return JUDGE_POSITIONS.sight;
  return null;
}
