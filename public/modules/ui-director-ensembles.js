import { renderDirectorEnsembleTable } from "./ui-director-ensemble-table.js";

export function createDirectorEnsembleRenderer({
  els,
  state,
  withLoading,
  fetchEntryStatus,
  handleDirectorEnsembleDelete,
  setDirectorEnsembleFormMode,
  handleDirectorEnsembleSelection,
  handleDirectorEnsembleOpenForms,
} = {}) {
  let statusLoadToken = 0;

  return async function renderDirectorEnsembles(ensembles = []) {
    if (!els.directorEnsembleList) return;
    const eventId = String(state.director.selectedEventId || "").trim();
    const statusMap = new Map();
    if (state.director.entryStatusCache instanceof Map && eventId) {
      ensembles.forEach((ensemble) => {
        const key = `${eventId}::${ensemble.id || ""}`;
        if (state.director.entryStatusCache.has(key)) {
          statusMap.set(ensemble.id, state.director.entryStatusCache.get(key));
        }
      });
    }
    renderDirectorEnsembleTable({
      container: els.directorEnsembleList,
      ensembles,
      selectedEnsembleId: state.director.selectedEnsembleId,
      selectedEventId: eventId,
      activeEntryStatus: state.director.entryDraft?.status || "",
      activeCompletionState: state.director.entryDraft ? {
        ready: state.director.entryDraft.status === "ready",
      } : null,
      statusByEnsembleId: statusMap,
      withLoading,
      onEdit: (ensemble) => {
        setDirectorEnsembleFormMode({ mode: "edit", ensemble });
        els.directorEnsembleNameInput?.focus();
      },
      onSetActive: (ensembleId) => handleDirectorEnsembleSelection(ensembleId),
      onOpenForms: (ensembleId) => handleDirectorEnsembleOpenForms?.(ensembleId),
      onCreate: () => {
        setDirectorEnsembleFormMode({ mode: "create" });
        els.directorEnsembleNameInput?.focus();
      },
      onDelete: async (ensembleId, ensembleName) =>
        handleDirectorEnsembleDelete(ensembleId, ensembleName),
    });

    if (!eventId || !ensembles.length || typeof fetchEntryStatus !== "function") return;
    const token = ++statusLoadToken;
    const results = await Promise.all(
      ensembles.map(async (ensemble) => {
        const ensembleId = String(ensemble.id || "").trim();
        if (!ensembleId) return [ensembleId, null];
        const key = `${eventId}::${ensembleId}`;
        if (state.director.entryStatusCache.has(key)) {
          return [ensembleId, state.director.entryStatusCache.get(key)];
        }
        const status = await fetchEntryStatus(eventId, ensembleId);
        state.director.entryStatusCache.set(key, status || "");
        return [ensembleId, status || ""];
      })
    );
    if (token !== statusLoadToken) return;
    const resolvedMap = new Map(results.filter(([ensembleId]) => ensembleId));
    renderDirectorEnsembleTable({
      container: els.directorEnsembleList,
      ensembles,
      selectedEnsembleId: state.director.selectedEnsembleId,
      selectedEventId: eventId,
      activeEntryStatus: state.director.entryDraft?.status || "",
      activeCompletionState: state.director.entryDraft ? {
        ready: state.director.entryDraft.status === "ready",
      } : null,
      statusByEnsembleId: resolvedMap,
      withLoading,
      onEdit: (ensemble) => {
        setDirectorEnsembleFormMode({ mode: "edit", ensemble });
        els.directorEnsembleNameInput?.focus();
      },
      onSetActive: (ensembleId) => handleDirectorEnsembleSelection(ensembleId),
      onOpenForms: (ensembleId) => handleDirectorEnsembleOpenForms?.(ensembleId),
      onCreate: () => {
        setDirectorEnsembleFormMode({ mode: "create" });
        els.directorEnsembleNameInput?.focus();
      },
      onDelete: async (ensembleId, ensembleName) =>
        handleDirectorEnsembleDelete(ensembleId, ensembleName),
    });
  };
}
