export function createJudgeOpenSession({
  els,
  state,
  selectOpenPacket,
  renderOpenSegments,
  setJudgeOpenDirectorReferenceState,
  renderJudgeOpenDirectorReference,
  refreshJudgeOpenDirectorReference,
  renderOpenCaptionForm,
  updateOpenHeader,
  updateOpenEmptyState,
  updateOpenSubmitState,
  showOpenDetailView,
  saveOpenPrefsToServer,
  loadOpenPrefs,
  canUseOpenJudge,
  syncOpenEventDefaultsUI,
  refreshOpenEventDefaultsState,
  applyOpenEventAssignmentDefaults,
  setOpenPacketHint,
} = {}) {
  function syncOpenFormTypeSegmented() {
    if (!els.judgeOpenFormTypeSegmented) return;
    const buttons = els.judgeOpenFormTypeSegmented.querySelectorAll("[data-form]");
    buttons.forEach((button) => {
      const isActive = button.dataset.form === (state.judgeOpen.formType || "stage");
      button.classList.toggle("is-active", isActive);
    });
    if (els.judgeOpenPrepTimePanel) {
      els.judgeOpenPrepTimePanel.classList.toggle(
        "is-hidden",
        (state.judgeOpen.formType || "stage") !== "sight"
      );
    }
  }

  async function openJudgeOpenPacket(packetId) {
    if (!packetId) return;
    const result = await selectOpenPacket(packetId, { onSessions: renderOpenSegments });
    if (result?.ok) {
      state.judgeOpen.tapePlaylistIndex = 0;
      if (els.judgeOpenSchoolNameInput) {
        els.judgeOpenSchoolNameInput.value = result.packet.schoolName || "";
      }
      if (els.judgeOpenEnsembleNameInput) {
        els.judgeOpenEnsembleNameInput.value = result.packet.ensembleName || "";
      }
      if (els.judgeOpenFormTypeSelect) {
        els.judgeOpenFormTypeSelect.value = result.packet.formType || "stage";
      }
      syncOpenFormTypeSegmented();
      if (els.judgeOpenExistingSelect) {
        if (result.packet.ensembleId) {
          els.judgeOpenExistingSelect.value = `${result.packet.schoolId}:${result.packet.ensembleId}`;
        } else {
          els.judgeOpenExistingSelect.value = "";
        }
      }
      if (els.judgeOpenTranscriptInput) {
        els.judgeOpenTranscriptInput.value =
          result.packet.transcriptFull || result.packet.transcript || "";
      }
      if (result.packet.directorEntrySnapshot) {
        setJudgeOpenDirectorReferenceState("loaded", "", result.packet.directorEntrySnapshot);
      } else {
        setJudgeOpenDirectorReferenceState("idle", "", null);
      }
      renderJudgeOpenDirectorReference();
      refreshJudgeOpenDirectorReference({ persistToPacket: false });
      renderOpenCaptionForm();
      updateOpenHeader();
      updateOpenEmptyState();
      updateOpenSubmitState();
      showOpenDetailView();
      await saveOpenPrefsToServer({
        lastJudgeOpenPacketId: packetId,
        lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
      });
      if (state.auth.userProfile) {
        state.auth.userProfile.preferences = {
          ...(state.auth.userProfile.preferences || {}),
          lastJudgeOpenPacketId: packetId,
          lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
        };
      }
    }
  }

  async function restoreOpenPacketFromPrefs() {
    if (state.judgeOpen.restoreAttempted) return;
    state.judgeOpen.restoreAttempted = true;
    if (!canUseOpenJudge(state.auth.userProfile)) return;
    const local = loadOpenPrefs();
    const prefs = state.auth.userProfile?.preferences || {};
    state.judgeOpen.useActiveEventDefaults =
      typeof prefs.judgeOpenUseActiveEventDefaults === "boolean"
        ? prefs.judgeOpenUseActiveEventDefaults
        : local.useActiveEventDefaults !== false;
    syncOpenEventDefaultsUI();
    refreshOpenEventDefaultsState();
    const defaultFormType = prefs.judgeOpenDefaultFormType || local.defaultFormType || "stage";
    const lastFormType = prefs.lastJudgeOpenFormType || local.lastFormType || defaultFormType;
    state.judgeOpen.formType = lastFormType || "stage";
    if (els.judgeOpenFormTypeSelect) {
      els.judgeOpenFormTypeSelect.value = state.judgeOpen.formType;
    }
    syncOpenFormTypeSegmented();
    renderOpenCaptionForm();
    applyOpenEventAssignmentDefaults();

    const lastPacketId = prefs.lastJudgeOpenPacketId || local.lastPacketId;
    if (!lastPacketId) {
      updateOpenEmptyState();
      updateOpenSubmitState();
      return;
    }
    const result = await selectOpenPacket(lastPacketId, { onSessions: renderOpenSegments });
    if (result?.ok) {
      if (els.judgeOpenPacketSelect) {
        els.judgeOpenPacketSelect.value = lastPacketId;
      }
      if (els.judgeOpenSchoolNameInput) {
        els.judgeOpenSchoolNameInput.value = result.packet.schoolName || "";
      }
      if (els.judgeOpenEnsembleNameInput) {
        els.judgeOpenEnsembleNameInput.value = result.packet.ensembleName || "";
      }
      if (els.judgeOpenExistingSelect) {
        els.judgeOpenExistingSelect.value = result.packet.ensembleId
          ? `${result.packet.schoolId}:${result.packet.ensembleId}`
          : "";
      }
      if (els.judgeOpenTranscriptInput) {
        els.judgeOpenTranscriptInput.value =
          result.packet.transcriptFull || result.packet.transcript || "";
      }
      if (result.packet.directorEntrySnapshot) {
        setJudgeOpenDirectorReferenceState("loaded", "", result.packet.directorEntrySnapshot);
      } else {
        setJudgeOpenDirectorReferenceState("idle", "", null);
      }
      renderJudgeOpenDirectorReference();
      refreshJudgeOpenDirectorReference({ persistToPacket: false });
      renderOpenCaptionForm();
      updateOpenHeader();
      showOpenDetailView();
      updateOpenEmptyState();
      updateOpenSubmitState();
      return;
    }
    setOpenPacketHint("Last packet not found.");
    updateOpenEmptyState();
    updateOpenSubmitState();
  }

  function formatDuration(totalSec) {
    if (!Number.isFinite(totalSec)) return "0:00";
    const seconds = Math.max(0, Math.floor(totalSec || 0));
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function buildTapePlaylist(sessions) {
    return sessions
      .filter((session) => session.masterAudioUrl)
      .map((session) => ({
        id: session.id,
        url: session.masterAudioUrl,
        durationSec: Number(session.durationSec || 0),
      }));
  }

  function updateTapePlayback(sessions) {
    if (!els.judgeOpenTapePlayback) return;
    const playlist = buildTapePlaylist(sessions);
    state.judgeOpen.tapePlaylist = playlist;
    const totalDuration = sessions.reduce(
      (sum, item) => {
        const value = Number(item.durationSec);
        return sum + (Number.isFinite(value) && value > 0 ? value : 0);
      },
      0
    );
    const safeDuration = Number.isFinite(totalDuration) ? totalDuration : 0;
    state.judgeOpen.tapeDurationSec = safeDuration;
    if (els.judgeOpenTapeDuration) {
      els.judgeOpenTapeDuration.textContent = formatDuration(safeDuration);
    }
    const hasAudio = playlist.length > 0;
    if (els.judgeOpenTapeEmpty) {
      els.judgeOpenTapeEmpty.style.display = hasAudio ? "none" : "block";
    }
    if (els.judgeOpenTapePlayback) {
      els.judgeOpenTapePlayback.style.display = hasAudio ? "block" : "none";
    }
    if (els.judgeOpenTapeDurationRow) {
      els.judgeOpenTapeDurationRow.style.display = safeDuration > 0 ? "block" : "none";
    }
    if (!hasAudio) {
      els.judgeOpenTapePlayback.removeAttribute("src");
      return;
    }
    const current = state.judgeOpen.tapePlaylistIndex || 0;
    const bounded = current < playlist.length ? current : 0;
    state.judgeOpen.tapePlaylistIndex = bounded;
    if (els.judgeOpenTapePlayback.src !== playlist[bounded].url) {
      els.judgeOpenTapePlayback.src = playlist[bounded].url;
    }
  }

  return {
    syncOpenFormTypeSegmented,
    openJudgeOpenPacket,
    restoreOpenPacketFromPrefs,
    updateTapePlayback,
  };
}
