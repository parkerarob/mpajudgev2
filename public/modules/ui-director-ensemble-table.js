function createCell(tag = "td", text = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

export function renderDirectorEnsembleTable({
  container,
  ensembles = [],
  selectedEnsembleId = null,
  onEdit,
  onSetActive,
  onOpenForms,
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
    empty.className = "hint";
    empty.textContent = "No ensembles yet. Add one to begin.";
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
        <th>Status</th>
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

    const statusCell = createCell("td", isActive ? "Active" : "Draft");
    statusCell.className = "muted";
    tr.appendChild(statusCell);

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

    const formsBtn = document.createElement("button");
    formsBtn.type = "button";
    formsBtn.className = "ghost";
    formsBtn.textContent = "Event Forms";
    formsBtn.addEventListener("click", () => onOpenForms?.(ensemble.id));
    actions.appendChild(formsBtn);

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
