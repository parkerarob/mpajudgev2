import { createAdminPreEventController } from "./ui-admin-preevent.js";
import { createAdminLiveEventController } from "./ui-admin-live.js";
import { createAdminResultsController } from "./ui-admin-results.js";
import { createAdminSetupController } from "./ui-admin-setup.js";
import { createAdminDirectoryController } from "./ui-admin-directory.js";
import { resolveAdminView } from "./admin-navigation.js";

export function createAdminViewController({
  els,
  state,
  isAdminLiveEventEnabled,
  isAdminSettingsEnabled,
  getEffectiveRole,
  renderLiveEventCheckinQueue,
  renderAdminSchoolDetail,
  renderRegisteredEnsemblesList,
  renderAdminPizzaTotals,
  renderAdminLiveSubmissions,
  renderAdminPacketsBySchedule,
  renderAdminRatingsView,
  renderAdminAnnouncerView,
  renderAdminReadinessView,
  renderEventList,
  renderAdminSchoolsDirectory,
  renderDirectorAssignmentsDirectory,
  renderAdminUsersDirectory,
} = {}) {
  function setSectionVisible(element, visible) {
    if (!element) return;
    element.classList.toggle("is-hidden", !visible);
    element.hidden = !visible;
    element.style.display = visible ? "" : "none";
  }

  const preEventController = createAdminPreEventController({
    els,
    renderAdminSchoolDetail,
    renderRegisteredEnsemblesList,
    renderAdminPizzaTotals,
    renderAdminReadinessView,
  });
  const liveController = createAdminLiveEventController({
    els,
    renderLiveEventCheckinQueue,
    renderAdminLiveSubmissions,
  });
  const resultsController = createAdminResultsController({
    els,
    state,
    getEffectiveRole,
    renderAdminPacketsBySchedule,
    renderAdminRatingsView,
  });
  const setupController = createAdminSetupController({
    els,
    renderEventList,
  });
  const directoryController = createAdminDirectoryController({
    els,
    renderAdminSchoolsDirectory,
    renderDirectorAssignmentsDirectory,
    renderAdminUsersDirectory,
  });

  function renderDashboardView() {
    if (!els.adminViewDashboard) return;
    const activeEvent = state.event.active || null;
    const rosterEntries = Array.isArray(state.event.rosterEntries) ? state.event.rosterEntries : [];
    const rawAssessments = Array.isArray(state.admin.rawAssessments) ? state.admin.rawAssessments : [];
    const readyCount = state.event.readyEnsembles instanceof Set ? state.event.readyEnsembles.size : 0;
    const scheduledCount = rosterEntries.length;
    const pendingCount = rawAssessments.filter((item) => {
      const reviewState = String(item?.reviewState || "").trim().toLowerCase();
      const status = String(item?.status || "").trim().toLowerCase();
      return status !== "excluded" && status !== "officialized" && reviewState !== "excluded";
    }).length;

    if (els.adminDashboardEventBadge) {
      els.adminDashboardEventBadge.textContent = activeEvent?.name || "No active event";
    }
    if (els.adminDashboardEventMeta) {
      els.adminDashboardEventMeta.textContent = activeEvent
        ? `${activeEvent.eventMode === "rehearsal" ? "Rehearsal" : "Live event"} • ${scheduledCount} scheduled ensemble${scheduledCount === 1 ? "" : "s"} • ${pendingCount} assessment${pendingCount === 1 ? "" : "s"} pending review`
        : "Set an active event to begin.";
    }
    if (els.adminDashboardRegistrationsValue) {
      els.adminDashboardRegistrationsValue.textContent = String(readyCount);
    }
    if (els.adminDashboardRegistrationsHint) {
      els.adminDashboardRegistrationsHint.textContent = activeEvent
        ? `${readyCount} ensemble${readyCount === 1 ? "" : "s"} currently marked ready in registrations.`
        : "No active event.";
    }
    if (els.adminDashboardScheduleValue) {
      els.adminDashboardScheduleValue.textContent = String(scheduledCount);
    }
    if (els.adminDashboardScheduleHint) {
      els.adminDashboardScheduleHint.textContent = activeEvent
        ? `${scheduledCount} ensemble${scheduledCount === 1 ? "" : "s"} currently on the active schedule.`
        : "No scheduled ensembles.";
    }
    if (els.adminDashboardSubmissionsValue) {
      els.adminDashboardSubmissionsValue.textContent = String(pendingCount);
    }
    if (els.adminDashboardSubmissionsHint) {
      els.adminDashboardSubmissionsHint.textContent = pendingCount
        ? `${pendingCount} assessment${pendingCount === 1 ? "" : "s"} need review or officialization.`
        : "No assessments waiting for review.";
    }
    if (els.adminDashboardReadyValue) {
      els.adminDashboardReadyValue.textContent = String(readyCount);
    }
    if (els.adminDashboardReadyHint) {
      els.adminDashboardReadyHint.textContent = activeEvent
        ? `${readyCount} ensemble${readyCount === 1 ? "" : "s"} currently ready in director/admin intake.`
        : "No active event.";
    }
  }

  function isAdminHeavyViewLoaded() {
    return true;
  }

  function isAdminSchoolDetailOpen() {
    return state.admin.currentView === "preEvent" && Boolean(state.admin.selectedSchoolId);
  }

  function applyAdminView(view) {
    const resolvedView = resolveAdminView(view, {
      liveEnabled: isAdminLiveEventEnabled(),
      settingsEnabled: isAdminSettingsEnabled(),
      fallback: "dashboard",
    });
    state.admin.currentView = resolvedView;

    const showDashboard   = resolvedView === "dashboard";
    const showSetup       = resolvedView === "setup"      && isAdminSettingsEnabled();
    const showDirectory   = resolvedView === "directory"  && isAdminSettingsEnabled();
    const showPreEvent    = resolvedView === "preEvent";
    const showLiveEvent   = resolvedView === "liveEvent"  && isAdminLiveEventEnabled();
    const showResults     = resolvedView === "results";
    const showAnnouncer   = resolvedView === "announcer";
    const showSchoolDetail = showPreEvent && Boolean(state.admin.selectedSchoolId);
    const heavyLoaded = isAdminHeavyViewLoaded(resolvedView);

    setSectionVisible(els.adminViewDashboard,      showDashboard);
    setSectionVisible(els.adminViewSetup,          showSetup);
    setSectionVisible(els.adminViewDirectory,      showDirectory);
    setSectionVisible(els.adminViewEvents,         showPreEvent);
    setSectionVisible(els.adminReadinessPanels,    showPreEvent);
    setSectionVisible(els.adminViewChair,          showLiveEvent);
    setSectionVisible(els.adminViewResults,        showResults);
    setSectionVisible(els.adminViewAnnouncer,      showAnnouncer);

    preEventController.setVisible(showPreEvent);
    liveController.setVisible(showLiveEvent);
    resultsController.setVisible(showResults);
    setupController.setVisible(showSetup);
    directoryController.setVisible(showDirectory);

    resultsController.syncActions();
    liveController.render({ visible: showLiveEvent, heavyLoaded });
    preEventController.render({ showSchoolDetail, heavyLoaded });

    if (showDashboard) renderDashboardView();
    resultsController.render({ visible: showResults });
    if (showAnnouncer) renderAdminAnnouncerView();
    setupController.render({ visible: showSetup });
    directoryController.render({ visible: showDirectory });

    // Nav button aria-selected states
    if (els.adminSubnavDashboardBtn) {
      els.adminSubnavDashboardBtn.setAttribute("aria-selected", showDashboard ? "true" : "false");
    }
    if (els.adminSubnavSetupBtn) {
      els.adminSubnavSetupBtn.classList.toggle("is-hidden", !isAdminSettingsEnabled());
      els.adminSubnavSetupBtn.setAttribute("aria-selected", showSetup ? "true" : "false");
    }
    if (els.adminSubnavDirectoryBtn) {
      els.adminSubnavDirectoryBtn.classList.toggle("is-hidden", !isAdminSettingsEnabled());
      els.adminSubnavDirectoryBtn.setAttribute("aria-selected", showDirectory ? "true" : "false");
    }
    if (els.adminSubnavEventChairBtn) {
      els.adminSubnavEventChairBtn.setAttribute("aria-selected", showPreEvent ? "true" : "false");
    }
    if (els.adminSubnavLiveBtn) {
      els.adminSubnavLiveBtn.classList.toggle("is-hidden", !isAdminLiveEventEnabled());
      els.adminSubnavLiveBtn.setAttribute("aria-selected", showLiveEvent ? "true" : "false");
    }
    if (els.adminSubnavResultsBtn) {
      els.adminSubnavResultsBtn.setAttribute("aria-selected", showResults ? "true" : "false");
    }
  }

  function closeAdminSchoolDetail() {
    state.admin.selectedSchoolId = null;
    state.admin.selectedSchoolName = "";
    applyAdminView("preEvent");
  }

  return {
    isAdminHeavyViewLoaded,
    isAdminSchoolDetailOpen,
    closeAdminSchoolDetail,
    applyAdminView,
    renderDashboardView,
  };
}
