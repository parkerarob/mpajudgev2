export function createAdminResultsController({
  els,
  renderAdminPacketsBySchedule,
  renderAdminRatingsView,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewResults) return;
    els.adminViewResults.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderAdminPacketsBySchedule();
    renderAdminRatingsView?.();
  }

  function syncActions() {}

  return {
    setVisible,
    render,
    syncActions,
  };
}
