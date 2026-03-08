export function createDirectorDashboardRenderer({ els, state } = {}) {
  return function renderDirectorDashboardLayout() {
    const enabled = state.app.features?.enableDirectorDashboardV2 !== false;
    if (els.directorCard) {
      els.directorCard.classList.toggle("director-dashboard-v2", enabled);
    }
    if (els.directorDashboardLayout) {
      els.directorDashboardLayout.classList.toggle("is-v2", enabled);
    }
  };
}
