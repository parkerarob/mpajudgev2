export function createDirectorEditorShellRenderer({ els, state } = {}) {
  return function renderDirectorEditorShell() {
    if (!els.directorEditorActiveEnsembleLabel) return;
    const selectedId = state.director.selectedEnsembleId || "";
    const selected = (state.director.ensemblesCache || []).find((item) => item.id === selectedId) || null;
    const event = (state.event.list || []).find((item) => item.id === state.director.selectedEventId) || state.event.active || null;
    const schoolName =
      String(els.directorSummarySchool?.textContent || "").trim() ||
      String(state.director.directorSchool?.name || "").trim() ||
      "School";
    els.directorEditorActiveEnsembleLabel.textContent = selected
      ? `Active Ensemble: ${selected.name}`
      : "Active Ensemble: none selected";
    if (els.directorWorkspaceContextNote) {
      els.directorWorkspaceContextNote.textContent = selected && event
        ? `${schoolName} • ${event.name || event.id || "Event"} • Editing ${selected.name}`
        : selected
          ? `${schoolName} • Select an event to finish opening this workspace.`
          : "Choose an event and active ensemble to open the workspace.";
    }
  };
}
