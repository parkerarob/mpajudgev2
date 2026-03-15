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
  hideOpenDetailView,
  saveOpenPrefsToServer,
  loadOpenPrefs,
  refreshOpenMicrophones,
  renderOpenMicOptions,
  canUseOpenJudge,
  syncOpenEventDefaultsUI,
  refreshOpenEventDefaultsState,
  applyOpenEventAssignmentDefaults,
  setOpenPacketHint,
} = {}) {
  const metadataDurationCacheSec = new Map();
  const metadataDurationPending = new Set();

  function cleanupMetadataProbe(audioEl, objectUrl = "") {
    if (!audioEl) return;
    audioEl.removeAttribute("src");
    audioEl.load?.();
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // no-op
      }
    }
  }

  function getSessionDurationSec(session) {
    const stored = Number(session?.durationSec || 0);
    if (Number.isFinite(stored) && stored > 0) return stored;
    const cached = Number(metadataDurationCacheSec.get(session?.id) || 0);
    if (Number.isFinite(cached) && cached > 0) return cached;
    return 0;
  }

  function probeSessionDurationIfNeeded(session) {
    const sessionId = String(session?.id || "");
    const url = String(session?.masterAudioUrl || "");
    if (!sessionId || !url) return;
    if (getSessionDurationSec(session) > 0) return;
    if (metadataDurationPending.has(sessionId)) return;
    metadataDurationPending.add(sessionId);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration || 0);
      if (Number.isFinite(duration) && duration > 0) {
        metadataDurationCacheSec.set(sessionId, duration);
        updateTapePlayback(state.judgeOpen.sessions || []);
      }
      metadataDurationPending.delete(sessionId);
      cleanupMetadataProbe(audio);
    };
    audio.onerror = () => {
      metadataDurationPending.delete(sessionId);
      cleanupMetadataProbe(audio);
    };
  }

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
    state.judgeOpen.detailViewIntent = "detail";
    if (state.judgeOpen.packetSelectionInFlight) {
      state.judgeOpen.pendingOpenPacketId = packetId;
      return;
    }
    const selectionToken = (state.judgeOpen.packetSelectionToken || 0) + 1;
    state.judgeOpen.packetSelectionToken = selectionToken;
    state.judgeOpen.packetSelectionInFlight = true;
    try {
      let nextPacketId = packetId;
      while (nextPacketId) {
        const targetPacketId = nextPacketId;
        state.judgeOpen.pendingOpenPacketId = "";
        const result = await selectOpenPacket(targetPacketId, { onSessions: renderOpenSegments });
        if (state.judgeOpen.packetSelectionToken !== selectionToken) return;
        if (result?.ok) {
          const packetMode = result.packet?.mode === "official" ? "official" : "practice";
          if (state.judgeOpen.mode && packetMode !== state.judgeOpen.mode) {
            setOpenPacketHint("That adjudication belongs to a different mode.");
            continue;
          }
          if (state.judgeOpen.detailViewIntent !== "detail") return;
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
            lastJudgeOpenPacketId: targetPacketId,
            lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
          });
          if (state.auth.userProfile) {
            state.auth.userProfile.preferences = {
              ...(state.auth.userProfile.preferences || {}),
              lastJudgeOpenPacketId: targetPacketId,
              lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
            };
          }
        }
        if (
          state.judgeOpen.pendingOpenPacketId &&
          state.judgeOpen.pendingOpenPacketId !== targetPacketId
        ) {
          nextPacketId = state.judgeOpen.pendingOpenPacketId;
          continue;
        }
        nextPacketId = "";
      }
    } finally {
      if (state.judgeOpen.packetSelectionToken === selectionToken) {
        state.judgeOpen.packetSelectionInFlight = false;
        state.judgeOpen.pendingOpenPacketId = "";
      }
    }
  }

  async function restoreOpenPacketFromPrefs() {
    if (state.judgeOpen.restoreAttempted) return;
    state.judgeOpen.restoreAttempted = true;
    if (!canUseOpenJudge(state.auth.userProfile)) return;
    if (!state.judgeOpen.mode) return;
    const local = loadOpenPrefs();
    const prefs = state.auth.userProfile?.preferences || {};
    state.judgeOpen.selectedMicDeviceId = prefs.judgeOpenMicDeviceId || local.micDeviceId || "";
    await refreshOpenMicrophones();
    renderOpenMicOptions(state.judgeOpen.availableMicrophones || []);
    state.judgeOpen.useActiveEventDefaults = true;
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
      const packetMode = result.packet?.mode === "official" ? "official" : "practice";
      if (state.judgeOpen.mode && packetMode !== state.judgeOpen.mode) {
        setOpenPacketHint("Last adjudication belongs to a different mode.");
        updateOpenEmptyState();
        updateOpenSubmitState();
        return;
      }
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
      hideOpenDetailView();
      updateOpenEmptyState();
      updateOpenSubmitState();
      return;
    }
    setOpenPacketHint("Last adjudication not found.");
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
    return [...sessions]
      .sort((a, b) => {
        const aTime = a?.startedAt?.toMillis ? a.startedAt.toMillis() : 0;
        const bTime = b?.startedAt?.toMillis ? b.startedAt.toMillis() : 0;
        return aTime - bTime;
      })
      .filter((session) => session.masterAudioUrl)
      .map((session) => ({
        id: session.id,
        url: session.masterAudioUrl,
        durationSec: getSessionDurationSec(session),
      }));
  }

  function updateTapePlayback(sessions) {
    if (!els.judgeOpenTapePlayback) return;
    els.judgeOpenTapePlayback.preload = "metadata";
    sessions.forEach((session) => {
      probeSessionDurationIfNeeded(session);
    });
    const playlist = buildTapePlaylist(sessions);
    state.judgeOpen.tapePlaylist = playlist;
    const totalDuration = sessions.reduce(
      (sum, item) => {
        const value = getSessionDurationSec(item);
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
    const playlistSig = playlist.map((item) => `${item.id}:${item.url}`).join("|");
    const packetChanged = state.judgeOpen.tapePlaybackPacketId !== state.judgeOpen.currentPacketId;
    const playlistChanged = state.judgeOpen.tapePlaylistSig !== playlistSig;
    if (packetChanged || playlistChanged) {
      state.judgeOpen.tapePlaylistIndex = 0;
    }
    state.judgeOpen.tapePlaybackPacketId = state.judgeOpen.currentPacketId || null;
    state.judgeOpen.tapePlaylistSig = playlistSig;
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
