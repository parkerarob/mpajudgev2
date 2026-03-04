export function createAdminLiveEventController({
  els,
  renderLiveEventCheckinQueue,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewChair) return;
    els.adminViewChair.classList.toggle("is-hidden", !visible);
  }

  function render({ visible, heavyLoaded } = {}) {
    if (!visible || !heavyLoaded) return;
    renderLiveEventCheckinQueue();
  }

  return {
    setVisible,
    render,
  };
}
