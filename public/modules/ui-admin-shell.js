import { createAdminPreEventController } from "./ui-admin-preevent.js";
import { createAdminEventDayController } from "./ui-admin-eventday.js";
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
  renderScheduleBuilder,
  renderAdminLiveSubmissions,
  renderAdminPacketsBySchedule,
  renderAdminRatingsView,
  renderAdminAnnouncerView,
  renderEventList,
  renderAdminSchoolsDirectory,
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
    renderScheduleBuilder,
  });
  const eventDayController = createAdminEventDayController({
    els,
    renderLiveEventCheckinQueue,
    renderAdminLiveSubmissions,
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
    renderAdminUsersDirectory,
  });

  function isAdminHeavyViewLoaded() {
    return true;
  }

  function isAdminSchoolDetailOpen() {
    return state.admin.currentView === "eventPrep" && Boolean(state.admin.selectedSchoolId);
  }

  function applyAdminView(view) {
    const resolvedView = resolveAdminView(view, {
      liveEnabled: isAdminLiveEventEnabled(),
      settingsEnabled: isAdminSettingsEnabled(),
      fallback: isAdminLiveEventEnabled() ? "eventDay" : "eventPrep",
    });
    state.admin.currentView = resolvedView;

    const showSetup       = resolvedView === "setup"      && isAdminSettingsEnabled();
    const showDirectory   = resolvedView === "directory"  && isAdminSettingsEnabled();
    const showPreEvent    = resolvedView === "eventPrep";
    const showEventDay    = resolvedView === "eventDay";
    const showAnnouncer   = resolvedView === "announcer";
    const showSchoolDetail = showPreEvent && Boolean(state.admin.selectedSchoolId);
    const heavyLoaded = isAdminHeavyViewLoaded(resolvedView);

    setSectionVisible(els.adminViewSetup,          showSetup);
    setSectionVisible(els.adminViewDirectory,      showDirectory);
    setSectionVisible(els.adminViewEvents,         showPreEvent);
    setSectionVisible(els.adminViewEventDay,       showEventDay);
    setSectionVisible(els.adminViewAnnouncer,      showAnnouncer);

    preEventController.setVisible(showPreEvent);
    eventDayController.setVisible(showEventDay);
    setupController.setVisible(showSetup);
    directoryController.setVisible(showDirectory);

    eventDayController.syncActions();
    eventDayController.render({ visible: showEventDay, heavyLoaded });
    preEventController.render({ showSchoolDetail, heavyLoaded });

    if (showAnnouncer) renderAdminAnnouncerView();
    setupController.render({ visible: showSetup });
    directoryController.render({ visible: showDirectory });

    if (els.adminSubnavSetupBtn) {
      els.adminSubnavSetupBtn.classList.toggle("is-hidden", !isAdminSettingsEnabled());
      els.adminSubnavSetupBtn.setAttribute("aria-selected", showSetup ? "true" : "false");
    }
    if (els.adminSubnavDirectoryBtn) {
      els.adminSubnavDirectoryBtn.classList.toggle("is-hidden", !isAdminSettingsEnabled());
      els.adminSubnavDirectoryBtn.setAttribute("aria-selected", showDirectory ? "true" : "false");
    }
    if (els.adminSubnavEventPrepBtn) {
      els.adminSubnavEventPrepBtn.setAttribute("aria-selected", showPreEvent ? "true" : "false");
    }
    if (els.adminSubnavEventDayBtn) {
      els.adminSubnavEventDayBtn.classList.toggle("is-hidden", !isAdminLiveEventEnabled());
      els.adminSubnavEventDayBtn.setAttribute("aria-selected", showEventDay ? "true" : "false");
    }
    if (els.adminSubnavAnnouncerLink) {
      els.adminSubnavAnnouncerLink.setAttribute("aria-selected", showAnnouncer ? "true" : "false");
    }
  }

  function closeAdminSchoolDetail() {
    state.admin.selectedSchoolId = null;
    state.admin.selectedSchoolName = "";
    applyAdminView("eventPrep");
  }

  return {
    isAdminHeavyViewLoaded,
    isAdminSchoolDetailOpen,
    closeAdminSchoolDetail,
    applyAdminView,
  };
}
