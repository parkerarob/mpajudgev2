export function createAdminResultsController({
  els,
  state,
  getEffectiveRole,
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

  function syncActions() {
    if (!els.adminPacketsMockPreviewBtn) return;
    const isAdmin = getEffectiveRole(state.auth.userProfile) === "admin";
    els.adminPacketsMockPreviewBtn.style.display = isAdmin ? "inline-flex" : "none";
  }

  return {
    setVisible,
    render,
    syncActions,
  };
}
