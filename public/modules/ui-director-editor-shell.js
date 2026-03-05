export function createDirectorEditorShellRenderer({ els, state } = {}) {
  return function renderDirectorEditorShell() {
    if (!els.directorEditorActiveEnsembleLabel) return;
    const selectedId = state.director.selectedEnsembleId || "";
    const selected = (state.director.ensemblesCache || []).find((item) => item.id === selectedId) || null;
    els.directorEditorActiveEnsembleLabel.textContent = selected?.name || "No active ensemble selected";
  };
}
