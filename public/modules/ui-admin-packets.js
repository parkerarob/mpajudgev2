export function createAdminPacketsController({
  els,
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

  function syncActions() {}

  return {
    setVisible,
    render,
    syncActions,
  };
}
