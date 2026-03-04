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
    els.judgeOpenDirectorRefStatus.textContent =
      message ||
      (status === "loading"
        ? "Loading Director repertoire/instrumentation..."
        : "Link an existing ensemble to load Director repertoire/instrumentation.");
    els.judgeOpenDirectorRefContent.innerHTML = "";

    if (!snapshot || status !== "loaded") return;

    const sourceRow = document.createElement("div");
    sourceRow.className = "note";
    const sourceName = snapshot.source?.eventName || snapshot.source?.eventId || "Active Event";
    sourceRow.textContent = `Loaded from Director entry for ${sourceName}`;
    els.judgeOpenDirectorRefContent.appendChild(sourceRow);

    const repPanel = document.createElement("div");
    repPanel.className = "panel";
    const repTitle = document.createElement("strong");
    repTitle.textContent = "Repertoire";
    repPanel.appendChild(repTitle);
    const repList = document.createElement("div");
    repList.className = "stack";
    const rep = snapshot.repertoire || {};
    const gradeText = snapshot.performanceGrade
      ? `${snapshot.performanceGrade}${snapshot.performanceGradeFlex ? "-Flex" : ""}`
      : "N/A";
    [
      ["Performance Grade", gradeText],
      ["March", [rep.march?.title, rep.march?.composer].filter(Boolean).join(" - ") || "Not provided"],
      [
        "Selection #1",
        [
          rep.selection1?.grade || "",
          rep.selection1?.title || "",
          rep.selection1?.composer || "",
        ]
          .filter(Boolean)
          .join(" - ") || "Not provided",
      ],
      [
        "Selection #2",
        [
          rep.selection2?.grade || "",
          rep.selection2?.title || "",
          rep.selection2?.composer || "",
        ]
          .filter(Boolean)
          .join(" - ") || "Not provided",
      ],
      [
        "Masterwork Exception",
        rep.repertoireRuleMode === "masterwork" ? "Yes" : "No",
      ],
    ].forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "note";
      row.textContent = `${label}: ${value}`;
      repList.appendChild(row);
    });
    repPanel.appendChild(repList);
    els.judgeOpenDirectorRefContent.appendChild(repPanel);

    const instrumentation = snapshot.instrumentation || {};
    const instPanel = document.createElement("div");
    instPanel.className = "panel";
    const instTitle = document.createElement("strong");
    instTitle.textContent = "Instrumentation";
    instPanel.appendChild(instTitle);
    const instList = document.createElement("div");
    instList.className = "stack";
    const standardCounts = instrumentation.standardCounts || {};
    const leftColumnKeys = [
      "flute",
      "oboe",
      "bassoon",
      "clarinet",
      "bassClarinet",
      "altoSax",
      "tenorSax",
      "bariSax",
    ];
    const rightColumnKeys = [
      "trumpetCornet",
      "horn",
      "trombone",
      "euphoniumBaritone",
      "tuba",
    ];
    const labelsByKey = Object.fromEntries(
      STANDARD_INSTRUMENTS.map((item) => [item.key, item.label])
    );
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    grid.style.gap = "8px 16px";
    const col1 = document.createElement("div");
    col1.className = "stack";
    col1.style.gap = "4px";
    const col2 = document.createElement("div");
    col2.className = "stack";
    col2.style.gap = "4px";
    const addCountRow = (parent, label, count) => {
      const row = document.createElement("div");
      row.className = "note";
      row.textContent = `${label}: ${Number(count || 0)}`;
      parent.appendChild(row);
    };
    leftColumnKeys.forEach((key) => {
      addCountRow(col1, labelsByKey[key] || key, standardCounts[key]);
    });
    rightColumnKeys.forEach((key) => {
      addCountRow(col2, labelsByKey[key] || key, standardCounts[key]);
    });
    addCountRow(col2, "Percussion", instrumentation.totalPercussion);
    grid.appendChild(col1);
    grid.appendChild(col2);
    instList.appendChild(grid);
    if (Array.isArray(instrumentation.nonStandard) && instrumentation.nonStandard.length) {
      const nonStandardRow = document.createElement("div");
      nonStandardRow.className = "note";
      nonStandardRow.textContent = `Non-standard: ${instrumentation.nonStandard
        .filter((row) => row?.instrumentName)
        .map((row) => `${row.instrumentName}${Number(row.count || 0) ? ` (${Number(row.count || 0)})` : ""}`)
        .join(" - ")}`;
      instList.appendChild(nonStandardRow);
    }
    if (instrumentation.otherInstrumentationNotes) {
      const noteRow = document.createElement("div");
      noteRow.className = "note";
      noteRow.textContent = `Notes: ${instrumentation.otherInstrumentationNotes}`;
      instList.appendChild(noteRow);
    }
    instPanel.appendChild(instList);
    els.judgeOpenDirectorRefContent.appendChild(instPanel);
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
        "Link an existing ensemble to load Director repertoire/instrumentation.",
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
        "No active event. Director repertoire/instrumentation unavailable.",
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
    setJudgeOpenDirectorReferenceState("loading", "Loading Director repertoire/instrumentation...", null);
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
            ? "No Director entry found for this ensemble in the active event."
            : result?.reason === "no-event"
              ? "No active event. Director repertoire/instrumentation unavailable."
              : (result?.message || "Unable to load Director entry reference.");
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
