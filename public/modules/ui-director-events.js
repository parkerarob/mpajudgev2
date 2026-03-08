export function createDirectorEventRenderers({
  els,
  state,
  hasDirectorUnsavedChanges,
  getEventCardLabel,
  formatDateHeading,
  loadDirectorEntry,
  applyDirectorEntryUpdate,
  applyDirectorEntryClear,
} = {}) {
  function updateDirectorEventMeta() {
    if (!els.directorEventMeta) return;
    const event = state.event.list.find((item) => item.id === state.director.selectedEventId);
    if (!event) {
      if (els.directorEventName) {
        els.directorEventName.textContent = "No event selected.";
      } else {
        els.directorEventMeta.textContent = "No event selected.";
      }
      if (els.directorEventDetail) {
        els.directorEventDetail.textContent = "";
      }
      if (els.directorScheduleBtn) {
        els.directorScheduleBtn.disabled = true;
      }
      return;
    }
    const name = event.name || "Event";
    const startDate = event.startAt ? formatDateHeading(event.startAt) : "";
    const endDate = event.endAt ? formatDateHeading(event.endAt) : "";
    const dateLabel =
      startDate && endDate && startDate !== endDate
        ? `${startDate} - ${endDate}`
        : startDate || endDate || "";
    if (els.directorEventName) {
      els.directorEventName.textContent = name;
    } else {
      els.directorEventMeta.textContent = name;
    }
    if (els.directorEventDetail) {
      els.directorEventDetail.textContent = dateLabel;
    }
    if (els.directorScheduleBtn) {
      els.directorScheduleBtn.disabled = false;
    }
  }

  function renderDirectorEventOptions() {
    if (hasDirectorUnsavedChanges()) {
      return;
    }
    const events = state.event.list || [];
    const exists = events.some((event) => event.id === state.director.selectedEventId);
    if (!exists) {
      state.director.selectedEventId = state.event.active?.id || events[0]?.id || null;
    }
    if (els.directorEventSelect) {
      els.directorEventSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select an event";
      els.directorEventSelect.appendChild(placeholder);
      events.forEach((event) => {
        const option = document.createElement("option");
        option.value = event.id;
        option.textContent = getEventCardLabel(event);
        els.directorEventSelect.appendChild(option);
      });
      if (state.director.selectedEventId) {
        els.directorEventSelect.value = state.director.selectedEventId;
      }
    }
    updateDirectorEventMeta();
    loadDirectorEntry({
      onUpdate: applyDirectorEntryUpdate,
      onClear: applyDirectorEntryClear,
    });
  }

  return {
    renderDirectorEventOptions,
    updateDirectorEventMeta,
  };
}
