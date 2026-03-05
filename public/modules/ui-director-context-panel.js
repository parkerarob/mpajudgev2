import { getEventCardLabel } from "./utils.js";

export function createDirectorContextPanelRenderer({ els, state } = {}) {
  return function renderDirectorContextPanel() {
    if (!els.directorDashboardContextMeta) return;
    const school = els.directorSummarySchool?.textContent?.trim() || "No school selected";
    const event = state.event.list.find((item) => item.id === state.director.selectedEventId) || null;
    const eventLabel = event ? getEventCardLabel(event) : "No event selected";
    els.directorDashboardContextMeta.textContent = `School: ${school} | Event: ${eventLabel}`;
  };
}
