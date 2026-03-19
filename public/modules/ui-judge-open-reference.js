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
    summary.className = "ref-summary";

    const makeRow = (label, value) => {
      const row = document.createElement("div");
      row.className = "ref-instr-row";
      const lbl = document.createElement("span");
      lbl.className = "ref-instr-label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.textContent = value || "—";
      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    };

    const addRow = (label, value) => {
      summary.appendChild(makeRow(label, value));
    };

    const addSectionLabel = (text) => {
      const el = document.createElement("div");
      el.className = "ref-section-label";
      el.textContent = text;
      summary.appendChild(el);
    };

    if (!snapshot || status !== "loaded") {
      const row = document.createElement("div");
      row.className = "note";
      row.textContent = "No director entry data available.";
      summary.appendChild(row);
      els.judgeOpenDirectorRefContent.appendChild(summary);
      return;
    }

    const rep = snapshot.repertoire || {};
    const gradeText = snapshot.performanceGrade
      ? `${snapshot.performanceGrade}${snapshot.performanceGradeFlex ? "-Flex" : ""}`
      : "N/A";
    const marchText =
      [rep.march?.title || "", rep.march?.composer || ""].filter(Boolean).join(" - ") || null;
    const selection1Text =
      [rep.selection1?.title || "", rep.selection1?.composer || ""]
        .filter(Boolean)
        .join(" - ") || null;
    const selection2Text =
      [rep.selection2?.title || "", rep.selection2?.composer || ""]
        .filter(Boolean)
        .join(" - ") || null;
    const instrumentation = snapshot.instrumentation || {};
    const standardCounts = instrumentation.standardCounts || {};
    const labelByKey = Object.fromEntries(
      STANDARD_INSTRUMENTS.map((item) => [item.key, item.label])
    );
    const woodwindKeys = ["flute", "oboe", "bassoon", "clarinet", "bassClarinet", "altoSax", "tenorSax", "bariSax"];
    const brassKeys = ["trumpetCornet", "horn", "trombone", "euphoniumBaritone", "tuba"];
    const nonStandardRows = Array.isArray(instrumentation.nonStandard)
      ? instrumentation.nonStandard.filter((r) => r?.instrumentName)
      : [];
    const instrumentationNotes = String(instrumentation.otherInstrumentationNotes || "").trim();

    // Grade
    const gradeEl = document.createElement("div");
    gradeEl.className = "ref-grade";
    gradeEl.textContent = `Grade ${gradeText}`;
    summary.appendChild(gradeEl);

    // Repertoire
    addSectionLabel("Repertoire");
    addRow("March", marchText);
    addRow("Selection #1", selection1Text);
    addRow("Selection #2", selection2Text);

    // Instrumentation — two columns
    addSectionLabel("Instrumentation");
    const instrGrid = document.createElement("div");
    instrGrid.className = "ref-instr-grid";

    const wwCol = document.createElement("div");
    wwCol.className = "ref-instr-col";
    woodwindKeys.forEach((key) => {
      wwCol.appendChild(makeRow(labelByKey[key] || key, String(Number(standardCounts[key] || 0))));
    });

    const bpCol = document.createElement("div");
    bpCol.className = "ref-instr-col";
    brassKeys.forEach((key) => {
      bpCol.appendChild(makeRow(labelByKey[key] || key, String(Number(standardCounts[key] || 0))));
    });
    bpCol.appendChild(makeRow("Percussion", String(Number(instrumentation.totalPercussion || 0))));

    instrGrid.appendChild(wwCol);
    instrGrid.appendChild(bpCol);

    if (nonStandardRows.length > 0) {
      const nsCol = document.createElement("div");
      nsCol.className = "ref-instr-col";
      nonStandardRows.forEach((r) => {
        nsCol.appendChild(makeRow(String(r.instrumentName || "").trim(), String(Number(r.count || 0))));
      });
      instrGrid.appendChild(nsCol);
    }

    summary.appendChild(instrGrid);

    if (instrumentationNotes) {
      addSectionLabel("Instrumentation Notes");
      const notesEl = document.createElement("div");
      notesEl.className = "note";
      notesEl.textContent = instrumentationNotes;
      summary.appendChild(notesEl);
    }

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
