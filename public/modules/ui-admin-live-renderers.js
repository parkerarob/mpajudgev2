export function createAdminLiveRenderers({
  els,
  state,
  db,
  COLLECTIONS,
  FIELDS,
  collection,
  getDocs,
  query,
  where,
  fetchScheduleEntries,
  fetchRegisteredEnsembles,
  getSchoolNameById,
  normalizeEnsembleDisplayName,
  toDateOrNull,
  computeEnsembleCheckinStatus,
  escapeHtml,
  formatStartTime,
  formatSchoolEnsembleLabel,
  buildAdminLogisticsEntryPanel,
  buildAdminLogisticsDiffPanel,
  updateEntryCheckinFields,
} = {}) {
  function closeLiveEventCheckinModal() {
    if (!els.liveEventCheckinModal) return;
    els.liveEventCheckinModal.classList.remove("is-open");
    els.liveEventCheckinModal.setAttribute("aria-hidden", "true");
    if (els.liveEventCheckinBody) els.liveEventCheckinBody.innerHTML = "";
  }

  function formatDateShort(dateLike) {
    const d = toDateOrNull(dateLike);
    if (!d) return "—";
    return d.toLocaleDateString();
  }

  function renderLiveEventStageSetup(parent, rows) {
    if (!parent || !Array.isArray(rows) || !rows.length) return;

    const panel = document.createElement("div");
    panel.className = "panel stack";
    const title = document.createElement("h4");
    title.textContent = "Stage Setup View";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Select Band On Stage and Next Band to view setup changes at a glance, including percussion.";
    panel.appendChild(title);
    panel.appendChild(hint);

    const controls = document.createElement("div");
    controls.className = "row";
    const currentLabel = document.createElement("label");
    currentLabel.className = "grow";
    currentLabel.textContent = "Band On Stage";
    const currentSelect = document.createElement("select");
    currentLabel.appendChild(currentSelect);
    const nextLabel = document.createElement("label");
    nextLabel.className = "grow";
    nextLabel.textContent = "Next Band";
    const nextSelect = document.createElement("select");
    nextLabel.appendChild(nextSelect);
    controls.appendChild(currentLabel);
    controls.appendChild(nextLabel);
    panel.appendChild(controls);

    const status = document.createElement("div");
    status.className = "note";
    panel.appendChild(status);

    const content = document.createElement("div");
    content.className = "stack";
    panel.appendChild(content);

    const sortedRows = [...rows].sort((a, b) => {
      const aTime = a.performanceAt?.getTime?.() || 0;
      const bTime = b.performanceAt?.getTime?.() || 0;
      return aTime - bTime;
    });
    const toLabel = (row) =>
      `${formatStartTime(row.performanceAt)} - ${formatSchoolEnsembleLabel({
        schoolName: row.schoolName,
        ensembleName: row.ensembleName,
        ensembleId: row.ensembleId,
      })}`;

    const fillSelect = (select, selectedId) => {
      select.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select an ensemble";
      select.appendChild(placeholder);
      sortedRows.forEach((row) => {
        const option = document.createElement("option");
        option.value = row.ensembleId;
        option.textContent = toLabel(row);
        select.appendChild(option);
      });
      if (selectedId && sortedRows.some((row) => row.ensembleId === selectedId)) {
        select.value = selectedId;
      }
    };

    const defaultCurrent = sortedRows[0]?.ensembleId || "";
    const defaultNext = sortedRows[1]?.ensembleId || defaultCurrent;
    state.admin.liveEventStageCurrentEnsembleId =
      state.admin.liveEventStageCurrentEnsembleId || defaultCurrent;
    state.admin.liveEventStageNextEnsembleId =
      state.admin.liveEventStageNextEnsembleId || defaultNext;

    fillSelect(currentSelect, state.admin.liveEventStageCurrentEnsembleId);
    fillSelect(nextSelect, state.admin.liveEventStageNextEnsembleId);

    const renderDetail = () => {
      const currentId = currentSelect.value || "";
      const nextId = nextSelect.value || "";
      state.admin.liveEventStageCurrentEnsembleId = currentId;
      state.admin.liveEventStageNextEnsembleId = nextId;
      content.innerHTML = "";

      if (!currentId || !nextId) {
        status.textContent = "Choose both ensembles to view stage setup.";
        return;
      }
      const currentRow = sortedRows.find((row) => row.ensembleId === currentId);
      const nextRow = sortedRows.find((row) => row.ensembleId === nextId);
      if (!currentRow || !nextRow) {
        status.textContent = "Unable to load one or both selected ensembles.";
        return;
      }

      status.textContent = "Showing at-a-glance setup and changeover diff.";
      content.appendChild(buildAdminLogisticsEntryPanel(currentRow.entry || {}, "Band On Stage"));
      content.appendChild(buildAdminLogisticsEntryPanel(nextRow.entry || {}, "Next Band"));
      content.appendChild(buildAdminLogisticsDiffPanel(currentRow.entry || {}, nextRow.entry || {}));
    };

    currentSelect.addEventListener("change", renderDetail);
    nextSelect.addEventListener("change", renderDetail);
    renderDetail();
    parent.appendChild(panel);
  }

  function renderLiveEventCheckinModalBody(row) {
    if (!els.liveEventCheckinBody) return;
    const checkin = computeEnsembleCheckinStatus({
      entry: row.entry || {},
      directorProfile: row.directorProfile || {},
    });
    const directorName =
      row.directorProfile?.displayName ||
      row.directorProfile?.email ||
      "No director profile on file";
    const nafmeNumber = row.directorProfile?.nafmeMembershipNumber || "—";
    const nafmeExp = formatDateShort(row.directorProfile?.nafmeMembershipExp);
    const cardUrl = row.directorProfile?.nafmeCardImageUrl || "";

    els.liveEventCheckinBody.innerHTML = "";
    const summary = document.createElement("div");
    summary.className = "stack";
    const nafmeStatusText = checkin.nafmeValidFromProfile
      ? "Valid from profile ✓"
      : checkin.nafmeManualVerified
        ? "Manually verified at check-in ✓"
        : "Missing/Expired";
    summary.innerHTML = `
      <div class="note"><strong>School:</strong> ${escapeHtml(row.schoolName)}</div>
      <div class="note"><strong>Ensemble:</strong> ${escapeHtml(row.ensembleName)}</div>
      <div class="note"><strong>Director:</strong> ${escapeHtml(directorName)}</div>
      <div class="note"><strong>NAfME:</strong> ${escapeHtml(nafmeStatusText)}</div>
      <div class="note"><strong>Membership #:</strong> ${escapeHtml(nafmeNumber)}</div>
      <div class="note"><strong>Expiration:</strong> ${escapeHtml(nafmeExp)}</div>
    `;
    if (cardUrl) {
      const openCardBtn = document.createElement("button");
      openCardBtn.type = "button";
      openCardBtn.className = "ghost";
      openCardBtn.textContent = "View NAfME Card Image";
      openCardBtn.addEventListener("click", () => {
        window.open(cardUrl, "_blank", "noopener,noreferrer");
      });
      summary.appendChild(openCardBtn);
    }
    els.liveEventCheckinBody.appendChild(summary);

    const checklist = document.createElement("div");
    checklist.className = "stack";
    const checks = [
      {
        key: "checkinNafmeManualVerified",
        label: checkin.nafmeValidFromProfile
          ? "NAfME membership verified (auto from profile)"
          : "NAfME membership verified (manual override)",
        checked: checkin.nafmeValid,
        disabled: checkin.nafmeValidFromProfile,
      },
      {
        key: "checkinScoresReceived",
        label: "Judge scores received at registration",
        checked: Boolean(row.entry?.checkinScoresReceived),
      },
      {
        key: "checkinChangesReviewed",
        label: "Director asked about ensemble changes",
        checked: Boolean(row.entry?.checkinChangesReviewed),
      },
    ];
    if (checkin.lunchRequired) {
      checks.push({
        key: "checkinLunchConfirmed",
        label: "Lunch request confirmed with director",
        checked: Boolean(row.entry?.checkinLunchConfirmed),
      });
    }

    checks.forEach((item) => {
      const label = document.createElement("label");
      label.className = "admin-school-checkin-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = item.checked;
      input.disabled = Boolean(item.disabled);
      const span = document.createElement("span");
      span.textContent = item.label;
      input.addEventListener("change", async () => {
        const nextVal = input.checked;
        input.disabled = true;
        try {
          await updateEntryCheckinFields(state.event.active?.id, row.ensembleId, { [item.key]: nextVal });
          row.entry = { ...(row.entry || {}), [item.key]: nextVal };
          renderLiveEventCheckinModalBody(row);
          renderLiveEventCheckinQueue();
        } catch (error) {
          console.error("Failed to save check-in field", error);
          input.checked = !nextVal;
        } finally {
          input.disabled = false;
        }
      });
      label.appendChild(input);
      label.appendChild(span);
      checklist.appendChild(label);
    });
    if (!checkin.lunchRequired) {
      const lunchNote = document.createElement("div");
      lunchNote.className = "hint";
      lunchNote.textContent = "Lunch not requested for this ensemble.";
      checklist.appendChild(lunchNote);
    }

    const result = document.createElement("div");
    result.className = checkin.checkedIn ? "badge badge--success" : "badge";
    result.textContent = checkin.checkedIn ? "Checked In ✓" : "Not Checked In";
    checklist.appendChild(result);
    els.liveEventCheckinBody.appendChild(checklist);
  }

  function openLiveEventCheckinModal(row) {
    if (!els.liveEventCheckinModal) return;
    if (els.liveEventCheckinTitle) {
      els.liveEventCheckinTitle.textContent = `${row.schoolName} ${row.ensembleName}`;
    }
    renderLiveEventCheckinModalBody(row);
    els.liveEventCheckinModal.classList.add("is-open");
    els.liveEventCheckinModal.setAttribute("aria-hidden", "false");
  }

  async function renderLiveEventCheckinQueue() {
    if (!els.liveEventContent) return;
    const eventId = state.event.active?.id || "";
    const eventName = state.event.active?.name || "Active Event";
    if (!eventId) {
      els.liveEventContent.innerHTML = "<p class='hint'>Set an active event to view Check-in Queue.</p>";
      return;
    }
    els.liveEventContent.innerHTML = "<p class='hint'>Loading check-in queue...</p>";
    try {
      let warningText = "";
      const schedEntries = await fetchScheduleEntries(eventId).catch((error) => {
        console.warn("Live Event check-in: schedule unavailable", error);
        warningText = "Schedule data is temporarily unavailable.";
        return state.event.rosterEntries || [];
      });
      const regEntries = await fetchRegisteredEnsembles(eventId).catch((error) => {
        console.warn("Live Event check-in: entry data unavailable", error);
        warningText = warningText
          ? `${warningText} Director entry data is partially unavailable.`
          : "Director entry data is partially unavailable.";
        return [];
      });
      const directorsSnap = await getDocs(
        query(
          collection(db, COLLECTIONS.users),
          where(FIELDS.users.role, "==", "director")
        )
      ).catch((error) => {
        console.warn("Live Event check-in: unable to read director profiles; continuing without NAfME detail", error);
        warningText = warningText
          ? `${warningText} NAfME details unavailable.`
          : "NAfME details unavailable.";
        return null;
      });
      const entryMap = new Map((regEntries || []).map((entry) => [entry.ensembleId || entry.id, entry]));
      const directorsBySchool = new Map();
      directorsSnap?.forEach((snap) => {
        const data = snap.data() || {};
        const schoolId = data.schoolId || "";
        if (!schoolId || directorsBySchool.has(schoolId)) return;
        directorsBySchool.set(schoolId, {
          uid: snap.id,
          displayName: data.displayName || "",
          email: data.email || "",
          nafmeMembershipNumber: data.nafmeMembershipNumber || "",
          nafmeMembershipExp: data.nafmeMembershipExp || null,
          nafmeCardImageUrl: data.nafmeCardImageUrl || "",
          cellPhone: data.cellPhone || "",
        });
      });
      const rows = (schedEntries || []).map((sched) => {
        const ensembleId = sched.ensembleId || sched.id;
        const reg = entryMap.get(ensembleId) || {};
        const schoolId = sched.schoolId || reg.schoolId || "";
        const directorProfile = directorsBySchool.get(schoolId) || {};
        const schoolName = sched.schoolName || reg.schoolName || getSchoolNameById(state.admin.schoolsList, reg.schoolId) || "—";
        const ensembleName = normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: sched.ensembleName || reg.ensembleName || "",
          ensembleId,
        }) || "—";
        const grade = reg.declaredGradeLevel || reg.performanceGrade || "—";
        const perfAt = toDateOrNull(sched.performanceAt);
        const checkin = computeEnsembleCheckinStatus({ entry: reg, directorProfile });
        return {
          ensembleId,
          schoolId,
          schoolName,
          ensembleName,
          grade,
          performanceAt: perfAt,
          entry: reg,
          directorProfile,
          checkin,
          checkedIn: checkin.checkedIn,
        };
      }).sort((a, b) => {
        const aTime = a.performanceAt?.getTime?.() || 0;
        const bTime = b.performanceAt?.getTime?.() || 0;
        return aTime - bTime;
      });

      if (!rows.length) {
        els.liveEventContent.innerHTML = `<p class='hint'>${escapeHtml(eventName)} has no scheduled ensembles yet.</p>`;
        return;
      }

      const allowedFilters = new Set(["all", "not-checked-in", "checked-in"]);
      const currentFilter = allowedFilters.has(state.admin.liveEventCheckinFilter)
        ? state.admin.liveEventCheckinFilter
        : "all";
      state.admin.liveEventCheckinFilter = currentFilter;
      const filteredRows = rows.filter((row) => {
        if (currentFilter === "not-checked-in") return !row.checkedIn;
        if (currentFilter === "checked-in") return row.checkedIn;
        return true;
      });

      const wrap = document.createElement("div");
      wrap.className = "stack";
      const topRow = document.createElement("div");
      topRow.className = "row row--between";
      const meta = document.createElement("div");
      meta.className = "note";
      meta.textContent = `Check-in Queue · ${eventName}`;
      topRow.appendChild(meta);
      const filter = document.createElement("select");
      filter.innerHTML = `
        <option value="all">All</option>
        <option value="not-checked-in">Not Checked In</option>
        <option value="checked-in">Checked In</option>
      `;
      filter.value = currentFilter;
      filter.addEventListener("change", () => {
        state.admin.liveEventCheckinFilter = filter.value || "all";
        renderLiveEventCheckinQueue();
      });
      topRow.appendChild(filter);
      wrap.appendChild(topRow);
      if (warningText) {
        const warn = document.createElement("div");
        warn.className = "hint";
        warn.textContent = warningText;
        wrap.appendChild(warn);
      }
      if (!filteredRows.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No ensembles match this filter.";
        wrap.appendChild(empty);
        renderLiveEventStageSetup(wrap, rows);
        els.liveEventContent.innerHTML = "";
        els.liveEventContent.appendChild(wrap);
        return;
      }
      const tableWrap = document.createElement("div");
      tableWrap.className = "schedule-timeline-table-wrap";
      const table = document.createElement("table");
      table.className = "schedule-timeline-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Time</th>
            <th>School</th>
            <th>Ensemble</th>
            <th>Grade</th>
            <th>Checked In</th>
            <th></th>
          </tr>
        </thead>
      `;
      const tbody = document.createElement("tbody");
      filteredRows.forEach((row) => {
        const tr = document.createElement("tr");
        const statusLabel = row.checkedIn
          ? "✓"
          : `${[
              row.checkin.nafmeValid,
              row.checkin.scoresReceived,
              row.checkin.changesReviewed,
              row.checkin.lunchConfirmed,
            ].filter(Boolean).length}/${row.checkin.lunchRequired ? 4 : 3}`;
        tr.innerHTML = `
          <td>${escapeHtml(formatStartTime(row.performanceAt))}</td>
          <td>${escapeHtml(row.schoolName)}</td>
          <td>${escapeHtml(row.ensembleName)}</td>
          <td>${escapeHtml(row.grade)}</td>
          <td>${escapeHtml(statusLabel)}</td>
        `;
        const actionsTd = document.createElement("td");
        const manageBtn = document.createElement("button");
        manageBtn.type = "button";
        manageBtn.className = "ghost live-checkin-manage-btn";
        manageBtn.dataset.ensembleId = row.ensembleId;
        manageBtn.textContent = "Check In";
        actionsTd.appendChild(manageBtn);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);
      renderLiveEventStageSetup(wrap, rows);
      els.liveEventContent.innerHTML = "";
      els.liveEventContent.appendChild(wrap);
      const rowMap = new Map(filteredRows.map((row) => [row.ensembleId, row]));
      els.liveEventContent.querySelectorAll(".live-checkin-manage-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = rowMap.get(btn.dataset.ensembleId || "");
          if (row) openLiveEventCheckinModal(row);
        });
      });
    } catch (error) {
      console.error("renderLiveEventCheckinQueue failed", error);
      const message = error?.message || error?.code || "unknown error";
      els.liveEventContent.innerHTML = `<p class='hint'>Unable to load check-in queue right now. (${escapeHtml(String(message))})</p>`;
    }
  }

  return {
    renderLiveEventCheckinQueue,
    closeLiveEventCheckinModal,
    openLiveEventCheckinModal,
    renderLiveEventCheckinModalBody,
  };
}
