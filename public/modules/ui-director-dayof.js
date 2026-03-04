export function createDirectorDayOfRenderer({
  state,
  loadDirectorEntry,
  applyDirectorEntryUpdate,
  applyDirectorEntryClear,
} = {}) {
  return function renderDayOfEnsembleSelector() {
    const sel = document.getElementById("directorDayOfEnsembleSelect");
    if (!sel) return;
    sel.innerHTML = "";
    const ensembles = state.director.ensemblesCache || [];
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select ensemble...";
    sel.appendChild(placeholder);
    ensembles.forEach((ensemble) => {
      const opt = document.createElement("option");
      opt.value = ensemble.id;
      opt.textContent = ensemble.name || "Untitled";
      if (ensemble.id === state.director.selectedEnsembleId) opt.selected = true;
      sel.appendChild(opt);
    });
    if (state.director.selectedEnsembleId) {
      loadDirectorEntry({
        onUpdate: applyDirectorEntryUpdate,
        onClear: applyDirectorEntryClear,
      });
    }
  };
}
