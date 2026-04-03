export function createAdminPreEventController({
  els,
  renderAdminSchoolDetail,
  renderRegisteredEnsemblesList,
  renderScheduleBuilder,
} = {}) {
  // "scheduled" (registered ensembles list) or "builder" (schedule builder)
  let activeSubtab = "scheduled";

  function setSubtab(subtab) {
    activeSubtab = subtab;

    const scheduledBtn = els.preEventSubtabScheduled;
    const builderBtn = els.preEventSubtabBuilder;
    if (scheduledBtn) scheduledBtn.classList.toggle("is-active", subtab === "scheduled");
    if (builderBtn) builderBtn.classList.toggle("is-active", subtab === "builder");

    const scheduledSection = els.adminRegisteredEnsemblesSection;
    const builderSection = els.adminScheduleBuilderSection;
    if (scheduledSection) scheduledSection.classList.toggle("is-hidden", subtab !== "scheduled");
    if (builderSection) builderSection.classList.toggle("is-hidden", subtab !== "builder");
  }

  function attachSubtabListeners() {
    const scheduledBtn = els.preEventSubtabScheduled;
    const builderBtn = els.preEventSubtabBuilder;
    if (scheduledBtn && !scheduledBtn._preEventListenerAttached) {
      scheduledBtn.addEventListener("click", () => {
        setSubtab("scheduled");
        renderRegisteredEnsemblesList?.();
      });
      scheduledBtn._preEventListenerAttached = true;
    }
    if (builderBtn && !builderBtn._preEventListenerAttached) {
      builderBtn.addEventListener("click", () => {
        setSubtab("builder");
        renderScheduleBuilder?.();
      });
      builderBtn._preEventListenerAttached = true;
    }
  }

  function setVisible(visible) {
    if (!els.adminViewEvents) return;
    els.adminViewEvents.classList.toggle("is-hidden", !visible);
  }

  function render({ showSchoolDetail, heavyLoaded } = {}) {
    if (!els.adminViewEvents || els.adminViewEvents.classList.contains("is-hidden")) return;

    attachSubtabListeners();

    if (els.preEventFlowPanel) els.preEventFlowPanel.classList.add("is-hidden");

    // School detail takes over the whole pre-event view
    if (els.adminSchoolDetailSection) {
      els.adminSchoolDetailSection.classList.toggle("is-hidden", !showSchoolDetail);
    }

    // Hide the subtab bar and both panels when school detail is showing
    if (els.preEventSubtabBar) els.preEventSubtabBar.classList.toggle("is-hidden", showSchoolDetail);

    if (showSchoolDetail) {
      if (els.adminRegisteredEnsemblesSection) els.adminRegisteredEnsemblesSection.classList.add("is-hidden");
      if (els.adminScheduleBuilderSection) els.adminScheduleBuilderSection.classList.add("is-hidden");
      if (heavyLoaded) {
        renderAdminSchoolDetail();
      } else if (els.adminSchoolDetailHint) {
        els.adminSchoolDetailHint.textContent =
          "Safe mode active. Click \"Load This View\" to load school details.";
      }
      return;
    }

    // Apply current subtab visibility
    setSubtab(activeSubtab);

    if (!heavyLoaded) {
      if (els.adminRegisteredEnsemblesList) {
        els.adminRegisteredEnsemblesList.innerHTML =
          "<li class='hint'>Safe mode: click \"Load This View\" to fetch schedule data.</li>";
      }
      return;
    }

    if (activeSubtab === "scheduled") {
      renderRegisteredEnsemblesList?.();
    } else {
      renderScheduleBuilder?.();
    }
  }

  return {
    setVisible,
    render,
  };
}
