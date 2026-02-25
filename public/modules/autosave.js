import { serverTimestamp, updateDoc } from "./firestore.js";
import { FIELDS, state } from "../state.js";
import {
  buildDirectorAutosavePayload,
  ensureEntryDocExists,
  hasDirectorUnsavedChanges,
} from "./director.js";
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
    autosaveOpenPacketDraft();
  }, 15000);
}
