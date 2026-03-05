import { renderDirectorEnsembleTable } from "./ui-director-ensemble-table.js";

export function createDirectorEnsembleRenderer({
  els,
  state,
  withLoading,
  handleDirectorEnsembleDelete,
  setDirectorEnsembleFormMode,
  handleDirectorEnsembleSelection,
} = {}) {
  return function renderDirectorEnsembles(ensembles = []) {
    if (!els.directorEnsembleList) return;
    renderDirectorEnsembleTable({
      container: els.directorEnsembleList,
      ensembles,
      selectedEnsembleId: state.director.selectedEnsembleId,
      withLoading,
      onEdit: (ensemble) => {
        setDirectorEnsembleFormMode({ mode: "edit", ensemble });
        els.directorEnsembleNameInput?.focus();
      },
      onSetActive: (ensembleId) => handleDirectorEnsembleSelection(ensembleId),
      onDelete: async (ensembleId, ensembleName) =>
        handleDirectorEnsembleDelete(ensembleId, ensembleName),
    });
  };
}
