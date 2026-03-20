import { createAdminPreEventController } from "./ui-admin-preevent.js";
import { createAdminLiveEventController } from "./ui-admin-live.js";
import { createAdminPacketsController } from "./ui-admin-packets.js";
import { createAdminReadinessController } from "./ui-admin-readiness.js";
import { createAdminSettingsController } from "./ui-admin-settings.js";
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
  });
  const liveController = createAdminLiveEventController({
    els,
    renderLiveEventCheckinQueue,
  });
  const packetsController = createAdminPacketsController({
    els,
    state,
    getEffectiveRole,
    renderAdminPacketsBySchedule,
  });
  const settingsController = createAdminSettingsController({
    els,
    renderEventList,
    renderAdminSchoolsDirectory,
    renderDirectorAssignmentsDirectory,
    renderAdminUsersDirectory,
  });
  const readinessController = createAdminReadinessController({
    els,
    renderAdminReadinessView,
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

  function isAdminHeavyViewLoaded(view) {
    if (!state.admin.safeMode) return true;
    if (view === "preEvent") return Boolean(state.admin.preEventHeavyLoaded);
    if (view === "liveEvent") return Boolean(state.admin.liveEventHeavyLoaded);
    return true;
  }

  function setAdminSafeModePanel(view) {
    if (!els.adminSafeModePanel || !els.adminSafeModeMessage || !els.adminSafeModeLoadBtn) return;
    const needsManualLoad =
      state.admin.safeMode &&
      (view === "preEvent" || view === "liveEvent") &&
      !isAdminHeavyViewLoaded(view);
    els.adminSafeModePanel.classList.toggle("is-hidden", !needsManualLoad);
    if (!needsManualLoad) return;
    if (view === "preEvent") {
      els.adminSafeModeMessage.textContent =
        "Admin safe mode is on. Registrations data is paused to prevent browser crashes.";
    } else {
      els.adminSafeModeMessage.textContent =
        "Admin safe mode is on. Schedule & Flow data is paused to prevent browser crashes.";
    }
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
    const showDashboard = resolvedView === "dashboard";
    const showPreEvent = resolvedView === "preEvent";
    const showPackets = resolvedView === "packets";
    const showRatings = resolvedView === "ratings";
    const showSubmissions = resolvedView === "submissions";
    const showAnnouncer = resolvedView === "announcer";
    const showLiveEvent = resolvedView === "liveEvent" && isAdminLiveEventEnabled();
    const showSettings = resolvedView === "settings" && isAdminSettingsEnabled();
    const showReadiness = resolvedView === "readiness";
    const showSchoolDetail = showPreEvent && Boolean(state.admin.selectedSchoolId);
    const heavyLoaded = isAdminHeavyViewLoaded(resolvedView);
    setAdminSafeModePanel(resolvedView);

    setSectionVisible(els.adminViewDashboard, showDashboard);
    setSectionVisible(els.adminViewEvents, showPreEvent);
    setSectionVisible(els.adminViewChair, showLiveEvent);
    setSectionVisible(els.adminViewSubmissions, showSubmissions);
    setSectionVisible(els.adminViewPackets, showPackets);
    setSectionVisible(els.adminViewRatings, showRatings);
    setSectionVisible(els.adminViewAnnouncer, showAnnouncer);
    setSectionVisible(els.adminViewSettings, showSettings);
    setSectionVisible(els.adminViewReadiness, showReadiness);
    liveController.setVisible(showLiveEvent);
    preEventController.setVisible(showPreEvent);
    packetsController.setVisible(showPackets);
    settingsController.setVisible(showSettings);
    readinessController.setVisible(showReadiness);
    packetsController.syncActions();
    liveController.render({ visible: showLiveEvent, heavyLoaded });
    preEventController.render({ showSchoolDetail, heavyLoaded });
    if (showDashboard) {
      renderDashboardView();
    }
    if (showSubmissions) {
      renderAdminLiveSubmissions();
    }
    packetsController.render({ visible: showPackets });
    if (showRatings) {
      renderAdminRatingsView();
    }
    if (showAnnouncer) {
      renderAdminAnnouncerView();
    }
    settingsController.render({ visible: showSettings });
    readinessController.render({ visible: showReadiness });
    if (els.adminSubnavDashboardBtn) {
      els.adminSubnavDashboardBtn.setAttribute("aria-selected", showDashboard ? "true" : "false");
    }
    if (els.adminSubnavChairBtn) {
      els.adminSubnavChairBtn.classList.toggle("is-hidden", !isAdminLiveEventEnabled());
      els.adminSubnavChairBtn.setAttribute("aria-selected", showLiveEvent ? "true" : "false");
    }
    if (els.adminSubnavEventChairBtn) {
      els.adminSubnavEventChairBtn.setAttribute("aria-selected", showPreEvent ? "true" : "false");
    }
    if (els.adminSubnavPacketsBtn) {
      els.adminSubnavPacketsBtn.setAttribute("aria-selected", showPackets ? "true" : "false");
    }
    if (els.adminSubnavRatingsBtn) {
      els.adminSubnavRatingsBtn.setAttribute("aria-selected", showRatings ? "true" : "false");
    }
    if (els.adminSubnavSubmissionsBtn) {
      els.adminSubnavSubmissionsBtn.setAttribute("aria-selected", showSubmissions ? "true" : "false");
    }
    if (els.adminSubnavAnnouncerBtn) {
      els.adminSubnavAnnouncerBtn.setAttribute("aria-selected", showAnnouncer ? "true" : "false");
    }
    if (els.adminSubnavReadinessBtn) {
      els.adminSubnavReadinessBtn.setAttribute("aria-selected", showReadiness ? "true" : "false");
    }
    if (els.adminSubnavSettingsBtn) {
      els.adminSubnavSettingsBtn.classList.toggle("is-hidden", !isAdminSettingsEnabled());
      els.adminSubnavSettingsBtn.setAttribute("aria-selected", showSettings ? "true" : "false");
    }
  }

  function closeAdminSchoolDetail() {
    state.admin.selectedSchoolId = null;
    state.admin.selectedSchoolName = "";
    applyAdminView("preEvent");
  }

  return {
    isAdminHeavyViewLoaded,
    setAdminSafeModePanel,
    isAdminSchoolDetailOpen,
    closeAdminSchoolDetail,
    applyAdminView,
    renderDashboardView,
  };
}
