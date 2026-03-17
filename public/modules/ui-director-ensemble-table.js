function createCell(tag = "td", text = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function createStepButton(label, onClick, { disabled = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost btn--sm";
  btn.textContent = label;
  btn.disabled = Boolean(disabled);
  if (typeof onClick === "function" && !disabled) {
    btn.addEventListener("click", onClick);
  }
  return btn;
}

export function renderDirectorEnsembleTable({
  container,
  ensembles = [],
  selectedEnsembleId = null,
  selectedEventId = null,
  activeEntryStatus = "",
  activeCompletionState = null,
  statusByEnsembleId = new Map(),
  onEdit,
  onSetActive,
  onOpenForms,
  onCreate,
  onDelete,
  withLoading,
} = {}) {
  if (!container) return;
  container.innerHTML = "";

  const ordered = [...ensembles].sort((a, b) => {
    const aActive = a.id === selectedEnsembleId ? 0 : 1;
    const bActive = b.id === selectedEnsembleId ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "empty stack";
    empty.innerHTML = `
      <div>No ensembles yet.</div>
      <div class="hint">Add your first ensemble, then open its workspace to complete event details.</div>
    `;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(createStepButton("Add Ensemble", () => onCreate?.()));
    empty.appendChild(actions);
    container.appendChild(empty);
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "director-ensemble-table-wrap";
  const table = document.createElement("table");
  table.className = "director-ensemble-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Workspace Status</th>
        <th>Next Step</th>
        <th>Actions</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");

  ordered.forEach((ensemble) => {
    const isActive = ensemble.id === selectedEnsembleId;
    const tr = document.createElement("tr");
    tr.className = isActive ? "is-active" : "";

    const nameCell = createCell("td", ensemble.name || "Untitled");
    if (isActive) nameCell.classList.add("is-active");
    tr.appendChild(nameCell);

    let workspaceStatus = "Available";
    let nextStep = selectedEventId ? "Open workspace" : "Select event";
    const savedStatus = statusByEnsembleId instanceof Map ? statusByEnsembleId.get(ensemble.id) || "" : "";
    if (isActive && selectedEventId) {
      if (activeCompletionState?.ready || activeEntryStatus === "ready") {
        workspaceStatus = "Ready";
        nextStep = "Review or update details";
      } else if (activeEntryStatus || activeCompletionState) {
        workspaceStatus = "In Progress";
        nextStep = "Finish required sections";
      } else {
        workspaceStatus = "Active Workspace";
        nextStep = "Open workspace";
      }
    } else if (isActive) {
      workspaceStatus = "Active";
      nextStep = "Choose event";
    } else if (selectedEventId && savedStatus === "ready") {
      workspaceStatus = "Ready";
      nextStep = "Review or update details";
    } else if (selectedEventId && savedStatus) {
      workspaceStatus = "In Progress";
      nextStep = "Finish required sections";
    } else if (selectedEventId) {
      workspaceStatus = "Not Started";
      nextStep = "Open workspace";
    }

    const statusCell = createCell("td", workspaceStatus);
    statusCell.className = "muted";
    tr.appendChild(statusCell);

    const nextCell = document.createElement("td");
    nextCell.className = "muted";
    if (!selectedEventId) {
      nextCell.textContent = nextStep;
    } else {
      const nextActionLabel =
        workspaceStatus === "Ready" ? "Review Workspace" : "Open Workspace";
      nextCell.appendChild(
        createStepButton(nextActionLabel, () => onOpenForms?.(ensemble.id))
      );
    }
    tr.appendChild(nextCell);

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ghost";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => onEdit?.(ensemble));
    actions.appendChild(editBtn);

    if (!isActive) {
      const activeBtn = document.createElement("button");
      activeBtn.type = "button";
      activeBtn.textContent = "Set Active";
      activeBtn.addEventListener("click", () => onSetActive?.(ensemble.id));
      actions.appendChild(activeBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      deleteBtn.dataset.loadingLabel = "Deleting...";
      deleteBtn.dataset.spinner = "true";
      await withLoading(deleteBtn, async () => {
        await onDelete?.(ensemble.id, ensemble.name);
      });
    });
    actions.appendChild(deleteBtn);
    actionsCell.appendChild(actions);
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
}
