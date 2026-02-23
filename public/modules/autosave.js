import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "./firestore.js";
import { COLLECTIONS, FIELDS, STATUSES, state } from "../state.js";
import { db } from "../firebase.js";
import {
  buildDirectorAutosavePayload,
  ensureEntryDocExists,
  hasDirectorUnsavedChanges,
} from "./director.js";
import {
  calculateCaptionTotal,
  computeFinalRating,
  getJudgeDraftSubmissionKey,
} from "./judge.js";
import {
  calculateCaptionTotal as calculateOpenCaptionTotal,
  computeFinalRating as computeOpenFinalRating,
  updateOpenPacketDraft,
} from "./judge-open.js";

export async function autosaveDirectorEntry() {
  if (!state.auth.currentUser || !state.auth.userProfile) return;
  if (!state.director.entryRef || !state.director.entryDraft) return;
  if (!hasDirectorUnsavedChanges()) return;
  if (state.director.entrySaveInFlight || state.director.autosaveInFlight) return;
  if (state.director.entryDraft.status === "ready") return;
  state.director.autosaveInFlight = true;
  const startVersion = state.director.draftVersion;
  try {
    await ensureEntryDocExists();
    const payload = buildDirectorAutosavePayload();
    await updateDoc(state.director.entryRef, {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    state.director.entryDraft.status = "draft";
    if (state.director.draftVersion === startVersion) {
      state.director.dirtySections.clear();
      return { ok: true, type: "director", cleared: true, status: "draft" };
    }
    return { ok: true, type: "director", cleared: false, status: "draft" };
  } catch (error) {
    console.error("Director autosave failed", error);
    return { ok: false, type: "director", error };
  } finally {
    state.director.autosaveInFlight = false;
  }
}

export async function autosaveJudgeDraft() {
  if (!state.judge.draftDirty) return;
  if (state.judge.autosaveInFlight) return;
  if (!state.auth.currentUser || !state.auth.userProfile || state.auth.userProfile.role !== "judge") return;
  if (state.judge.isTestMode) return;
  if (!state.event.active || !state.judge.selectedRosterEntry || !state.judge.position || !state.judge.formType) return;
  const submissionKey = getJudgeDraftSubmissionKey();
  if (!submissionKey) return;
  if (state.judge.draftSubmissionKey && state.judge.draftSubmissionKey !== submissionKey) return;
  state.judge.autosaveInFlight = true;
  const startVersion = state.judge.draftVersion;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionKey);
  try {
    const submissionSnap = await getDoc(submissionRef);
    const currentStatus = submissionSnap.exists() ? submissionSnap.data()?.status : null;
    if (currentStatus === STATUSES.submitted || currentStatus === STATUSES.released) {
      return;
    }
    const captionScoreTotal = calculateCaptionTotal(state.judge.captions);
    const rating = computeFinalRating(captionScoreTotal);
    const payload = {
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
      [FIELDS.submissions.eventId]: state.event.active.id,
      [FIELDS.submissions.ensembleId]: state.judge.selectedRosterEntry.ensembleId,
      [FIELDS.submissions.judgePosition]: state.judge.position,
      [FIELDS.submissions.formType]: state.judge.formType,
      [FIELDS.submissions.transcript]: state.judge.transcriptText.trim(),
      [FIELDS.submissions.captions]: state.judge.captions,
      [FIELDS.submissions.captionScoreTotal]: captionScoreTotal,
      [FIELDS.submissions.computedFinalRatingJudge]: rating.value,
      [FIELDS.submissions.computedFinalRatingLabel]: rating.label,
      [FIELDS.submissions.updatedAt]: serverTimestamp(),
    };
    if (!submissionSnap.exists()) {
      payload[FIELDS.submissions.createdAt] = serverTimestamp();
      await setDoc(submissionRef, payload);
    } else {
      await setDoc(submissionRef, payload, { merge: true });
    }
    if (state.judge.draftVersion === startVersion) {
      state.judge.draftDirty = false;
      state.judge.draftSubmissionKey = submissionKey;
      return { ok: true, type: "judge", cleared: true };
    }
    return { ok: true, type: "judge", cleared: false };
  } catch (error) {
    console.error("Judge autosave failed", error);
    return { ok: false, type: "judge", error };
  } finally {
    state.judge.autosaveInFlight = false;
  }
}

export async function autosaveOpenPacketDraft() {
  if (!state.judgeOpen.draftDirty) return;
  if (state.judgeOpen.autosaveInFlight) return;
  if (!state.auth.currentUser || !state.auth.userProfile) return;
  if (!state.judgeOpen.currentPacketId) return;
  state.judgeOpen.autosaveInFlight = true;
  const startVersion = state.judgeOpen.draftVersion;
  try {
    const captionScoreTotal = calculateOpenCaptionTotal(state.judgeOpen.captions);
    const rating = computeOpenFinalRating(captionScoreTotal);
    await updateOpenPacketDraft({
      transcript: state.judgeOpen.transcriptText || "",
      transcriptFull: state.judgeOpen.transcriptText || "",
      captions: state.judgeOpen.captions || {},
      captionScoreTotal,
      computedFinalRatingJudge: rating.value,
      computedFinalRatingLabel: rating.label,
      formType: state.judgeOpen.formType || "stage",
    });
    if (state.judgeOpen.draftVersion === startVersion) {
      state.judgeOpen.draftDirty = false;
      return { ok: true, type: "judge-open", cleared: true };
    }
    return { ok: true, type: "judge-open", cleared: false };
  } catch (error) {
    console.error("Open packet autosave failed", error);
    return { ok: false, type: "judge-open", error };
  } finally {
    state.judgeOpen.autosaveInFlight = false;
  }
}

export function startAutosaveLoop() {
  if (state.app.autosaveIntervalId) return;
  state.app.autosaveIntervalId = window.setInterval(() => {
    autosaveDirectorEntry();
    autosaveJudgeDraft();
    autosaveOpenPacketDraft();
  }, 15000);
}
