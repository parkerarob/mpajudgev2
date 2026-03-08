export function createAdminReadinessController({
  els,
  renderAdminReadinessView,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewReadiness) return;
    els.adminViewReadiness.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderAdminReadinessView?.();
  }

  return {
    setVisible,
    render,
  };
}
