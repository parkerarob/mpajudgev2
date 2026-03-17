export function createAdminPreEventController({
  els,
  renderAdminSchoolDetail,
  renderRegisteredEnsemblesList,
  renderAdminPizzaTotals,
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
    if (els.adminPizzaTotalsSection) {
      els.adminPizzaTotalsSection.classList.toggle("is-hidden", showSchoolDetail);
    }
    if (els.adminPizzaBySchoolSection) {
      els.adminPizzaBySchoolSection.classList.toggle("is-hidden", showSchoolDetail);
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
    if (!heavyLoaded) {
      if (els.adminPizzaTotalsHint) {
        els.adminPizzaTotalsHint.textContent =
          "Admin safe mode is on. Load this view to refresh pizza totals.";
      }
      if (els.adminPizzaBySchoolHint) {
        els.adminPizzaBySchoolHint.textContent =
          "Admin safe mode is on. Load this view to refresh school totals.";
      }
    }
    if (heavyLoaded && typeof renderAdminPizzaTotals === "function") {
      void renderAdminPizzaTotals();
    }
    if (heavyLoaded) {
      renderRegisteredEnsemblesList();
      return;
    }
    if (els.adminRegisteredEnsemblesList) {
      els.adminRegisteredEnsemblesList.innerHTML =
        "<li class='hint'>Safe mode: click \"Load This View\" to fetch registrations and schedule data.</li>";
    }
  }

  return {
    setVisible,
    render,
  };
}
