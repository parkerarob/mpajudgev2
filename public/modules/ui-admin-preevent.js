export function createAdminPreEventController({
  els,
  renderAdminSchoolDetail,
  renderRegisteredEnsemblesList,
} = {}) {
  function setVisible(visible) {
    if (!els.adminViewEvents) return;
    els.adminViewEvents.classList.toggle("is-hidden", !visible);
  }

  function render({ showSchoolDetail, heavyLoaded } = {}) {
    if (!els.adminViewEvents || els.adminViewEvents.classList.contains("is-hidden")) return;
    if (els.preEventFlowPanel) els.preEventFlowPanel.classList.add("is-hidden");
    if (els.adminRegisteredEnsemblesSection) {
      els.adminRegisteredEnsemblesSection.classList.toggle("is-hidden", showSchoolDetail);
    }
    if (els.adminScheduleSection) {
      els.adminScheduleSection.classList.toggle("is-hidden", showSchoolDetail);
    }
    if (els.adminSchoolDetailSection) {
      els.adminSchoolDetailSection.classList.toggle("is-hidden", !showSchoolDetail);
    }
    if (showSchoolDetail) {
      if (heavyLoaded) {
        renderAdminSchoolDetail();
      } else if (els.adminSchoolDetailHint) {
        els.adminSchoolDetailHint.textContent =
          "Safe mode active. Click \"Load This View\" to load school details.";
      }
      return;
    }
    if (heavyLoaded) {
      renderRegisteredEnsemblesList();
      return;
    }
    if (els.adminRegisteredEnsemblesList) {
      els.adminRegisteredEnsemblesList.innerHTML =
        "<li class='hint'>Safe mode: click \"Load This View\" to fetch full Pre-Event data.</li>";
    }
  }

  return {
    setVisible,
    render,
  };
}
