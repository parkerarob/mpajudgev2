export function createAdminEventDayController({
  els,
  renderAdminLiveSubmissions,
  renderAdminPacketsBySchedule,
  renderAdminRatingsView,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewEventDay) return;
    els.adminViewEventDay.classList.toggle("is-hidden", !visible);
  }

  function render({ visible, heavyLoaded } = {}) {
    if (!visible || !heavyLoaded) return;
    renderAdminLiveSubmissions?.();
    renderAdminPacketsBySchedule?.();
    renderAdminRatingsView?.();
  }

  function syncActions() {}

  return {
    setVisible,
    render,
    syncActions,
  };
}
