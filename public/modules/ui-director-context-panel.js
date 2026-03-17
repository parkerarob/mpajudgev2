import { getEventCardLabel } from "./utils.js";

export function createDirectorContextPanelRenderer({ els, state } = {}) {
  return function renderDirectorContextPanel() {
    if (!els.directorDashboardContextMeta && !els.directorDashboardEventMeta && !els.directorDashboardEnsembleMeta) return;
    const school = els.directorSummarySchool?.textContent?.trim() || "No school selected";
    const event = state.event.list.find((item) => item.id === state.director.selectedEventId) || null;
    const eventLabel = event ? getEventCardLabel(event) : "No event selected";
    const selectedId = state.director.selectedEnsembleId || "";
    const selected = (state.director.ensemblesCache || []).find((item) => item.id === selectedId) || null;
    const ensembleLabel = selected?.name || "No active ensemble";
    if (els.directorDashboardContextMeta) {
      els.directorDashboardContextMeta.textContent = `School: ${school}`;
    }
    if (els.directorDashboardEventMeta) {
      els.directorDashboardEventMeta.textContent = `Event: ${eventLabel}`;
    }
    if (els.directorDashboardEnsembleMeta) {
      els.directorDashboardEnsembleMeta.textContent = `Active Ensemble: ${ensembleLabel}`;
    }
  };
}
