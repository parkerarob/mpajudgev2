export function createJudgeOpenDirectorReference({
  els,
  state,
  STANDARD_INSTRUMENTS,
  loadDirectorEntrySnapshotForJudge,
  updateOpenPacketDraft,
} = {}) {
  function setJudgeOpenDirectorReferenceState(status, message = "", snapshot = null) {
    state.judgeOpen.directorEntryReferenceStatus = status;
    state.judgeOpen.directorEntryReferenceMessage = message || "";
    state.judgeOpen.directorEntryReference = snapshot || null;
  }

  function renderJudgeOpenDirectorReference() {
    if (!els.judgeOpenDirectorRefStatus || !els.judgeOpenDirectorRefContent) return;
    const status = state.judgeOpen.directorEntryReferenceStatus || "idle";
    const message = state.judgeOpen.directorEntryReferenceMessage || "";
    const snapshot = state.judgeOpen.directorEntryReference || null;
    const selected = state.judgeOpen.selectedExisting || {};
    els.judgeOpenDirectorRefStatus.textContent =
      message ||
      (status === "loading"
        ? "Loading ensemble context..."
        : "");
    els.judgeOpenDirectorRefContent.innerHTML = "";

    const summary = document.createElement("div");
    summary.className = "stack";
    const addRow = (label, value) => {
      const row = document.createElement("div");
      row.className = "note";
      row.textContent = `${label}: ${value || "N/A"}`;
      summary.appendChild(row);
    };
    addRow("School", selected.schoolName || "");
    addRow("Ensemble", selected.ensembleName || "");

    if (!snapshot || status !== "loaded") {
      addRow("Grade", "N/A");
      addRow("Repertoire", "N/A");
      addRow("Instrumentation", "N/A");
      els.judgeOpenDirectorRefContent.appendChild(summary);
      return;
    }

    const rep = snapshot.repertoire || {};
    const gradeText = snapshot.performanceGrade
      ? `${snapshot.performanceGrade}${snapshot.performanceGradeFlex ? "-Flex" : ""}`
      : "N/A";
    const marchText =
      [rep.march?.title || "", rep.march?.composer || ""].filter(Boolean).join(" - ") || "N/A";
    const selection1Text =
      [rep.selection1?.title || "", rep.selection1?.composer || ""]
        .filter(Boolean)
        .join(" - ") || "N/A";
    const selection2Text =
      [rep.selection2?.title || "", rep.selection2?.composer || ""]
        .filter(Boolean)
        .join(" - ") || "N/A";
    const instrumentation = snapshot.instrumentation || {};
    const standardCounts = instrumentation.standardCounts || {};
    const labelByKey = Object.fromEntries(
      STANDARD_INSTRUMENTS.map((item) => [item.key, item.label])
    );
    const woodwindKeys = [
      "flute",
      "oboe",
      "bassoon",
      "clarinet",
      "bassClarinet",
      "altoSax",
      "tenorSax",
      "bariSax",
    ];
    const brassKeys = [
      "trumpetCornet",
      "horn",
      "trombone",
      "euphoniumBaritone",
      "tuba",
    ];
    const buildFamilyLine = (keys) =>
      keys
        .map((key) => `${labelByKey[key] || key} ${Number(standardCounts[key] || 0)}`)
        .join(", ");
    const woodwindDetail = buildFamilyLine(woodwindKeys);
    const brassPercDetail = `${buildFamilyLine(brassKeys)}, Percussion ${Number(
      instrumentation.totalPercussion || 0
    )}`;
    const nonStandardRows = Array.isArray(instrumentation.nonStandard)
      ? instrumentation.nonStandard.filter((row) => row?.instrumentName)
      : [];
    const nonStandardDetail = nonStandardRows.length
      ? nonStandardRows
        .map((row) => `${String(row.instrumentName || "").trim()} ${Number(row.count || 0)}`)
        .join(", ")
      : "None";
    addRow("Grade", gradeText);
    addRow("March", marchText);
    addRow("Selection #1", selection1Text);
    addRow("Selection #2", selection2Text);
    addRow("Woodwinds", woodwindDetail);
    addRow("Brass/Percussion", brassPercDetail);
    addRow("Non-standard", nonStandardDetail);
    els.judgeOpenDirectorRefContent.appendChild(summary);
  }

  function areDirectorEntrySnapshotsEqual(a, b) {
    return JSON.stringify(a || null) === JSON.stringify(b || null);
  }

  function syncOpenDirectorEntrySnapshotDraft(nextSnapshot) {
    const currentPacket = state.judgeOpen.currentPacket || {};
    const currentSnapshot = currentPacket.directorEntrySnapshot || null;
    if (areDirectorEntrySnapshotsEqual(currentSnapshot, nextSnapshot || null)) {
      return;
    }
    state.judgeOpen.currentPacket = {
      ...currentPacket,
      directorEntrySnapshot: nextSnapshot || null,
    };
    if (!state.judgeOpen.currentPacketId) return;
    updateOpenPacketDraft({ directorEntrySnapshot: nextSnapshot || null }).catch((error) => {
      console.error("Failed syncing open packet director snapshot", error);
    });
  }

  async function refreshJudgeOpenDirectorReference({ persistToPacket = true } = {}) {
    if (!els.judgeOpenDirectorRefStatus || !els.judgeOpenDirectorRefContent) return;
    const existing = state.judgeOpen.selectedExisting;
    if (!existing?.schoolId || !existing?.ensembleId) {
      setJudgeOpenDirectorReferenceState(
        "not-linked",
        "",
        null
      );
      renderJudgeOpenDirectorReference();
      if (persistToPacket) {
        syncOpenDirectorEntrySnapshotDraft(null);
      }
      return;
    }
    const activeEvent = state.event.active || null;
    if (!activeEvent?.id) {
      setJudgeOpenDirectorReferenceState(
        "no-active-event",
        "",
        null
      );
      renderJudgeOpenDirectorReference();
      if (persistToPacket) {
        syncOpenDirectorEntrySnapshotDraft(null);
      }
      return;
    }

    const version = (state.judgeOpen.directorEntryReferenceLoadVersion || 0) + 1;
    state.judgeOpen.directorEntryReferenceLoadVersion = version;
    setJudgeOpenDirectorReferenceState("loading", "Loading...", null);
    renderJudgeOpenDirectorReference();
    try {
      const result = await loadDirectorEntrySnapshotForJudge({
        eventId: activeEvent.id,
        ensembleId: existing.ensembleId,
      });
      if (state.judgeOpen.directorEntryReferenceLoadVersion !== version) return;
      if (!result?.ok) {
        const message =
          result?.reason === "not-found"
            ? ""
            : result?.reason === "no-event"
              ? ""
              : (result?.message || "");
        setJudgeOpenDirectorReferenceState(result?.reason || "error", message, null);
        renderJudgeOpenDirectorReference();
        if (persistToPacket) {
          syncOpenDirectorEntrySnapshotDraft(null);
        }
        return;
      }
      setJudgeOpenDirectorReferenceState("loaded", "", result.snapshot);
      renderJudgeOpenDirectorReference();
      if (persistToPacket) {
        syncOpenDirectorEntrySnapshotDraft(result.snapshot);
      }
    } catch (error) {
      console.error("refreshJudgeOpenDirectorReference failed", error);
      if (state.judgeOpen.directorEntryReferenceLoadVersion !== version) return;
      setJudgeOpenDirectorReferenceState("error", "Unable to load Director entry reference.", null);
      renderJudgeOpenDirectorReference();
    }
  }

  return {
    setJudgeOpenDirectorReferenceState,
    renderJudgeOpenDirectorReference,
    refreshJudgeOpenDirectorReference,
    syncOpenDirectorEntrySnapshotDraft,
  };
}
