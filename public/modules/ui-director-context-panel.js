import { getEventCardLabel } from "./utils.js";

export function createDirectorContextPanelRenderer({ els, state } = {}) {
  return function renderDirectorContextPanel() {
    if (!els.directorDashboardContextMeta && !els.directorDashboardEventMeta) return;
    const school = els.directorSummarySchool?.textContent?.trim() || "No school selected";
    const event = state.event.list.find((item) => item.id === state.director.selectedEventId) || null;
    const eventLabel = event ? getEventCardLabel(event) : "No event selected";
    if (els.directorDashboardContextMeta) {
      els.directorDashboardContextMeta.textContent = `School: ${school}`;
    }
    if (els.directorDashboardEventMeta) {
      els.directorDashboardEventMeta.textContent = `Event: ${eventLabel}`;
    }
  };
}
