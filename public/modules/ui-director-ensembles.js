export function createDirectorEnsembleRenderer({
  els,
  state,
  withLoading,
  handleDirectorEnsembleDelete,
  setDirectorEnsembleFormMode,
  handleDirectorEnsembleSelection,
} = {}) {
  return function renderDirectorEnsembles(ensembles = []) {
    if (!els.directorEnsembleList) return;
    els.directorEnsembleList.innerHTML = "";
    ensembles.forEach((ensemble) => {
      const li = document.createElement("li");
      li.className = "ensemble-row";
      const isActive = ensemble.id === state.director.selectedEnsembleId;
      if (isActive) return;
      const name = document.createElement("div");
      name.className = isActive ? "ensemble-name is-active" : "ensemble-name";
      name.textContent = ensemble.name || "Untitled";
      li.appendChild(name);
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        deleteBtn.dataset.loadingLabel = "Deleting...";
        deleteBtn.dataset.spinner = "true";
        await withLoading(deleteBtn, async () => {
          await handleDirectorEnsembleDelete(ensemble.id, ensemble.name);
        });
      });
      const actions = document.createElement("div");
      actions.className = "ensemble-actions";
      if (!isActive) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "ghost";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
          setDirectorEnsembleFormMode({ mode: "edit", ensemble });
          els.directorEnsembleNameInput?.focus();
        });
        actions.appendChild(editBtn);

        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.textContent = "Set Active";
        selectBtn.addEventListener("click", () => handleDirectorEnsembleSelection(ensemble.id));
        actions.appendChild(selectBtn);
      }
      actions.appendChild(deleteBtn);
      li.appendChild(actions);
      els.directorEnsembleList.appendChild(li);
    });
  };
}
