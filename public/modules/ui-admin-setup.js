export function createAdminSetupController({
  els,
  renderEventList,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewSetup) return;
    els.adminViewSetup.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderEventList();
  }

  return {
    setVisible,
    render,
  };
}
