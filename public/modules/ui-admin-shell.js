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
  renderAdminLiveSubmissions,
  renderAdminPacketsBySchedule,
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
        "Admin safe mode is on. Pre-Event heavy data is paused to prevent browser crashes.";
    } else {
      els.adminSafeModeMessage.textContent =
        "Admin safe mode is on. Live Event heavy data is paused to prevent browser crashes.";
    }
  }

  function isAdminSchoolDetailOpen() {
    return state.admin.currentView === "preEvent" && Boolean(state.admin.selectedSchoolId);
  }

  function applyAdminView(view) {
    const resolvedView = resolveAdminView(view, {
      liveEnabled: isAdminLiveEventEnabled(),
      settingsEnabled: isAdminSettingsEnabled(),
      fallback: "preEvent",
    });
    state.admin.currentView = resolvedView;
    const showPreEvent = resolvedView === "preEvent";
    const showPackets = resolvedView === "packets";
    const showSubmissions = resolvedView === "submissions";
    const showAnnouncer = resolvedView === "announcer";
    const showLiveEvent = resolvedView === "liveEvent" && isAdminLiveEventEnabled();
    const showSettings = resolvedView === "settings" && isAdminSettingsEnabled();
    const showReadiness = resolvedView === "readiness";
    const showSchoolDetail = showPreEvent && Boolean(state.admin.selectedSchoolId);
    const heavyLoaded = isAdminHeavyViewLoaded(resolvedView);
    setAdminSafeModePanel(resolvedView);

    setSectionVisible(els.adminViewEvents, showPreEvent);
    setSectionVisible(els.adminViewChair, showLiveEvent);
    setSectionVisible(els.adminViewSubmissions, showSubmissions);
    setSectionVisible(els.adminViewPackets, showPackets);
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
    if (showSubmissions) {
      renderAdminLiveSubmissions();
    }
    packetsController.render({ visible: showPackets });
    if (showAnnouncer) {
      renderAdminAnnouncerView();
    }
    settingsController.render({ visible: showSettings });
    readinessController.render({ visible: showReadiness });
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
  };
}
