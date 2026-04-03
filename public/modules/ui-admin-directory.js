export function createAdminDirectoryController({
  els,
  renderAdminSchoolsDirectory,
  renderAdminUsersDirectory,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewDirectory) return;
    els.adminViewDirectory.classList.toggle("is-hidden", !visible);
  }

  function render({ visible } = {}) {
    if (!visible) return;
    renderAdminSchoolsDirectory();
    renderAdminUsersDirectory();
  }

  return {
    setVisible,
    render,
  };
}
