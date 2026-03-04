export function createAdminSettingsController({
  els,
  renderEventList,
  renderAdminSchoolsDirectory,
  renderDirectorAssignmentsDirectory,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewSettings) return;
    els.adminViewSettings.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderEventList();
    renderAdminSchoolsDirectory();
    renderDirectorAssignmentsDirectory();
  }

  return {
    setVisible,
    render,
  };
}
