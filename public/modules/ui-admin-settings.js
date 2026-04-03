export function createAdminSettingsController({
  els,
  renderEventList,
  renderAdminSchoolsDirectory,
  renderAdminUsersDirectory,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewSettings) return;
    els.adminViewSettings.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderEventList();
    renderAdminSchoolsDirectory();
    renderAdminUsersDirectory();
  }

  return {
    setVisible,
    render,
  };
}
