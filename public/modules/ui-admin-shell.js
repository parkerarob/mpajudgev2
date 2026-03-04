import { createAdminPreEventController } from "./ui-admin-preevent.js";
import { createAdminLiveEventController } from "./ui-admin-live.js";
import { createAdminPacketsController } from "./ui-admin-packets.js";
import { createAdminSettingsController } from "./ui-admin-settings.js";

export function createAdminViewController({
  els,
  state,
  isAdminLiveEventEnabled,
  isAdminSettingsEnabled,
  getEffectiveRole,
  renderLiveEventCheckinQueue,
  renderAdminSchoolDetail,
  renderRegisteredEnsemblesList,
  renderAdminPacketsBySchedule,
  renderEventList,
  renderAdminSchoolsDirectory,
  renderDirectorAssignmentsDirectory,
} = {}) {
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
    if (view === "liveEvent" && !isAdminLiveEventEnabled()) view = "preEvent";
    if (view === "settings" && !isAdminSettingsEnabled()) view = "preEvent";
    state.admin.currentView = view;
    const showPreEvent = view === "preEvent";
    const showPackets = view === "packets";
    const showLiveEvent = view === "liveEvent" && isAdminLiveEventEnabled();
    const showSettings = view === "settings" && isAdminSettingsEnabled();
    const showSchoolDetail = showPreEvent && Boolean(state.admin.selectedSchoolId);
    const heavyLoaded = isAdminHeavyViewLoaded(view);
    setAdminSafeModePanel(view);

    liveController.setVisible(showLiveEvent);
    preEventController.setVisible(showPreEvent);
    packetsController.setVisible(showPackets);
    settingsController.setVisible(showSettings);
    packetsController.syncActions();
    liveController.render({ visible: showLiveEvent, heavyLoaded });
    preEventController.render({ showSchoolDetail, heavyLoaded });
    packetsController.render({ visible: showPackets });
    settingsController.render({ visible: showSettings });
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
