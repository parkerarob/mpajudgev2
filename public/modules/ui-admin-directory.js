export function createAdminDirectoryController({
  els,
  renderAdminSchoolsDirectory,
  renderDirectorAssignmentsDirectory,
  renderAdminUsersDirectory,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewDirectory) return;
    els.adminViewDirectory.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderAdminSchoolsDirectory();
    renderDirectorAssignmentsDirectory();
    renderAdminUsersDirectory();
  }

  return {
    setVisible,
    render,
  };
}
