export function createAdminPacketsController({
  els,
  state,
  getEffectiveRole,
  renderAdminPacketsBySchedule,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewPackets) return;
    els.adminViewPackets.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderAdminPacketsBySchedule();
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
