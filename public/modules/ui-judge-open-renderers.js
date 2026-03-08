export function createJudgeOpenRenderers({
  els,
  state,
  confirmUser,
  withLoading,
  deleteOpenPacket,
  resetJudgeOpenState,
  setJudgeOpenDirectorReferenceState,
  renderJudgeOpenDirectorReference,
  renderOpenSegments,
  renderOpenCaptionForm,
  updateOpenHeader,
  hideOpenDetailView,
  updateOpenEmptyState,
  updateOpenSubmitState,
  saveOpenPrefs,
  saveOpenPrefsToServer,
  openJudgeOpenPacket,
  setOpenPacketHint,
} = {}) {
  function formatPacketUpdatedAt(packet) {
    const raw = packet.updatedAt?.toMillis ? packet.updatedAt.toMillis() : null;
    if (!raw) return "Updated recently";
    return new Date(raw).toLocaleString();
  }

  function computePacketProgress(packet) {
    if (!packet) return 0;
    if (["submitted", "locked", "released"].includes(packet.status)) return 100;
    const hasTranscript = Boolean(packet.transcriptFull || packet.transcript);
    const hasCaptions = packet.captions && Object.keys(packet.captions).length > 0;
    if (hasTranscript && hasCaptions) return 75;
    if (packet.segmentCount || packet.audioSessionCount) return 40;
    return 10;
  }

  async function handleDeletePacket(packet, deleteBtn) {
    if (state.judgeOpen.mediaRecorder?.state === "recording") {
      setOpenPacketHint("Stop recording before deleting an adjudication.");
      return;
    }
    if (state.judgeOpen.packetMutationInFlight) {
      setOpenPacketHint("Please wait for the current adjudication action to complete.");
      return;
    }
    const label = `${packet.schoolName || "Unknown school"} - ${packet.ensembleName || "Unknown ensemble"}`;
    if (!confirmUser(`Delete adjudication for ${label}? This removes adjudication audio and sessions.`)) {
      return;
    }
    deleteBtn.dataset.loadingLabel = "Deleting...";
    deleteBtn.dataset.spinner = "true";
    const mutationToken = (state.judgeOpen.packetMutationToken || 0) + 1;
    state.judgeOpen.packetMutationToken = mutationToken;
    state.judgeOpen.packetMutationInFlight = true;
    try {
      await withLoading(deleteBtn, async () => {
        const deletingCurrentPacket = state.judgeOpen.currentPacketId === packet.id;
        if (deletingCurrentPacket) {
          hideOpenDetailView();
        }
        await deleteOpenPacket({ packetId: packet.id });
        if (state.judgeOpen.packetMutationToken !== mutationToken) return;
        if (deletingCurrentPacket) {
          resetJudgeOpenState();
          state.judgeOpen.packetMutationInFlight = true;
          state.judgeOpen.packetMutationToken = mutationToken;
          setJudgeOpenDirectorReferenceState(
            "not-linked",
            "Link an existing ensemble to load Director repertoire/instrumentation.",
            null
          );
          renderJudgeOpenDirectorReference();
          if (els.judgeOpenPacketSelect) els.judgeOpenPacketSelect.value = "";
          if (els.judgeOpenExistingSelect) els.judgeOpenExistingSelect.value = "";
          if (els.judgeOpenSchoolNameInput) els.judgeOpenSchoolNameInput.value = "";
          if (els.judgeOpenEnsembleNameInput) els.judgeOpenEnsembleNameInput.value = "";
          if (els.judgeOpenTranscriptInput) els.judgeOpenTranscriptInput.value = "";
          if (els.judgeOpenDraftStatus) els.judgeOpenDraftStatus.textContent = "";
          renderOpenCaptionForm();
          updateOpenHeader();
          updateOpenEmptyState();
          updateOpenSubmitState();
          saveOpenPrefs({ lastPacketId: "" });
          try {
            await saveOpenPrefsToServer({ lastJudgeOpenPacketId: "" });
          } catch (error) {
            console.error("Clear open packet preference failed", error);
          }
          if (state.auth.userProfile) {
            state.auth.userProfile.preferences = {
              ...(state.auth.userProfile.preferences || {}),
              lastJudgeOpenPacketId: "",
            };
          }
        }
        setOpenPacketHint("Adjudication deleted.");
      });
    } finally {
      if (state.judgeOpen.packetMutationToken === mutationToken) {
        state.judgeOpen.packetMutationInFlight = false;
      }
    }
  }

  function renderOpenPacketCards(packets) {
    if (!els.judgeOpenPacketList) return;
    els.judgeOpenPacketList.innerHTML = "";
    packets.forEach((packet) => {
      const card = document.createElement("div");
      card.className = "packet-card";
      card.dataset.packetId = packet.id;
      const progress = computePacketProgress(packet);
      const statusRaw = packet.status || "draft";
      const status = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
      const mode = packet.mode === "official" ? "Official" : "Practice";
      const creator =
        packet.createdByJudgeName ||
        packet.createdByJudgeEmail ||
        packet.createdByJudgeUid ||
        "Unknown judge";
      card.innerHTML = `
        <div class="packet-card-header">
          <div class="packet-card-title">${packet.schoolName || "Unknown school"} - ${packet.ensembleName || "Unknown ensemble"}</div>
          <span class="status-badge">${status}</span>
        </div>
        <div class="packet-card-meta">${mode} adjudication</div>
        <div class="packet-card-meta">Judge: ${creator}</div>
        <div class="packet-card-meta">${formatPacketUpdatedAt(packet)}</div>
        <div class="progress-bar"><span style="width: ${progress}%"></span></div>
      `;
      const actions = document.createElement("div");
      actions.className = "row";
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await handleDeletePacket(packet, deleteBtn);
      });
      actions.appendChild(deleteBtn);
      card.appendChild(actions);
      card.addEventListener("click", () => {
        if (state.judgeOpen.packetMutationInFlight || state.judgeOpen.packetSelectionInFlight) {
          return;
        }
        if (els.judgeOpenPacketSelect) {
          els.judgeOpenPacketSelect.value = packet.id;
        }
        openJudgeOpenPacket(packet.id);
      });
      els.judgeOpenPacketList.appendChild(card);
    });
  }

  function renderOpenPacketOptions(packets = []) {
    if (!els.judgeOpenPacketSelect) return;
    els.judgeOpenPacketSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = packets.length ? "Select an adjudication" : "No adjudications yet";
    els.judgeOpenPacketSelect.appendChild(placeholder);
    packets.forEach((packet) => {
      const option = document.createElement("option");
      option.value = packet.id;
      option.textContent = packet.display || packet.id;
      els.judgeOpenPacketSelect.appendChild(option);
    });
    renderOpenPacketCards(packets);
  }

  function renderOpenExistingOptions(items = []) {
    if (!els.judgeOpenExistingSelect) return;
    els.judgeOpenExistingSelect.innerHTML = "";
    const sorted = [...items].sort((a, b) => {
      const school = (a.schoolName || "").localeCompare(b.schoolName || "");
      if (school !== 0) return school;
      return (a.ensembleName || "").localeCompare(b.ensembleName || "");
    });
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = items.length ? "Select existing ensemble" : "No ensembles available";
    els.judgeOpenExistingSelect.appendChild(placeholder);
    sorted.forEach((item) => {
      const option = document.createElement("option");
      option.value = `${item.schoolId}:${item.ensembleId}`;
      option.textContent = `${item.schoolName} — ${item.ensembleName}`;
      option.dataset.schoolId = item.schoolId;
      option.dataset.schoolName = item.schoolName;
      option.dataset.ensembleId = item.ensembleId;
      option.dataset.ensembleName = item.ensembleName;
      els.judgeOpenExistingSelect.appendChild(option);
    });
    if (state.judgeOpen.selectedExisting?.ensembleId) {
      els.judgeOpenExistingSelect.value = `${state.judgeOpen.selectedExisting.schoolId}:${state.judgeOpen.selectedExisting.ensembleId}`;
    }
  }

  return {
    renderOpenPacketOptions,
    renderOpenExistingOptions,
  };
}
