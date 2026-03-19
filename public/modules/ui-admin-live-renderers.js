export function createAdminLiveRenderers({
  els,
  state,
  db,
  COLLECTIONS,
  FIELDS,
  collection,
  getDocs,
  query,
  fetchScheduleEntries,
  fetchRegisteredEnsembles,
  getSchoolNameById,
  normalizeEnsembleDisplayName,
  toDateOrNull,
  computeEnsembleCheckinStatus,
  computeEnsembleCheckinProgress,
  escapeHtml,
  formatStartTime,
  formatSchoolEnsembleLabel,
  buildAdminLogisticsEntryPanel,
  buildAdminLogisticsDiffPanel,
  updateEntryCheckinFields,
  openModal,
  closeModal,
} = {}) {
  function formatSignedDiff(value) {
    const n = Number(value || 0);
    if (n > 0) return `+${n}`;
    if (n < 0) return `${n}`;
    return "0";
  }

  function getStageDiffSummary(currentEntry, nextEntry) {
    const currentRows = Array.isArray(currentEntry?.seating?.rows) ? currentEntry.seating.rows : [];
    const nextRows = Array.isArray(nextEntry?.seating?.rows) ? nextEntry.seating.rows : [];
    const rowCount = Math.max(currentRows.length, nextRows.length, 5);
    let totalChairDelta = 0;
    let totalStandDelta = 0;
    const rows = [];
    for (let i = 0; i < rowCount; i += 1) {
      const currentRow = currentRows[i] || {};
      const nextRow = nextRows[i] || {};
      const currentChairs = Number(currentRow.chairs || 0);
      const nextChairs = Number(nextRow.chairs || 0);
      const currentStands = Number(currentRow.stands || 0);
      const nextStands = Number(nextRow.stands || 0);
      const chairDelta = nextChairs - currentChairs;
      const standDelta = nextStands - currentStands;
      totalChairDelta += chairDelta;
      totalStandDelta += standDelta;
      rows.push({
        rowNumber: i + 1,
        currentChairs,
        nextChairs,
        currentStands,
        nextStands,
        chairDelta,
        standDelta,
      });
    }
    return { totalChairDelta, totalStandDelta, rows };
  }

  function openStageDisplayWindow({ rows = [], currentIndex = 0, eventName }) {
    const popup = window.open("", "_blank", "popup,width=1440,height=900");
    if (!popup) return false;
    const stageRows = rows.map((row) => ({
      label: formatSchoolEnsembleLabel({
        schoolName: row.schoolName,
        ensembleName: row.ensembleName,
        ensembleId: row.ensembleId,
      }),
      entry: row.entry || {},
    }));
    const payload = JSON.stringify({
      eventName: eventName || "Stage Flow",
      currentIndex,
      rows: stageRows,
    }).replace(/</g, "\\u003c");
    popup.document.open();
    popup.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Stage Flow Display</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #07111d;
      color: #f5f7fb;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .screen {
      width: min(95vw, 1720px);
      height: min(95vh, calc(95vw * 9 / 16));
      padding: 18px 24px;
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), #0d1726;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 28px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.35);
      overflow: hidden;
    }
    .header, .bands, .totals, .diff-row { display: grid; align-items: center; }
    .header { text-align: center; gap: 4px; }
    .eyebrow { font-size: clamp(14px, 1.3vw, 18px); letter-spacing: 0.08em; text-transform: uppercase; color: #aab6cf; }
    .title { font-size: clamp(24px, 2.4vw, 38px); font-weight: 700; }
    .actions { display: flex; justify-content: center; gap: 10px; }
    .actions button { font: inherit; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: #f5f7fb; border-radius: 12px; padding: 8px 14px; cursor: pointer; }
    .actions button:disabled { opacity: 0.4; cursor: default; }
    .bands { grid-template-columns: 1fr auto 1fr; gap: 12px; text-align: center; }
    .band-card, .totals, .diff-row {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 22px;
    }
    .band-card { padding: 10px 14px; }
    .band-label { font-size: clamp(14px, 1.4vw, 20px); color: #aab6cf; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
    .band-name { font-size: clamp(18px, 1.8vw, 28px); font-weight: 700; line-height: 1.08; }
    .arrow { font-size: clamp(28px, 2.5vw, 40px); color: #ddb56b; font-weight: 700; }
    .content { display: grid; grid-template-rows: auto auto 1fr; gap: 10px; min-height: 0; }
    .totals { grid-template-columns: 120px 1fr 1fr; gap: 10px; padding: 10px 14px; text-align: center; }
    .totals-label { font-size: clamp(16px, 1.4vw, 22px); font-weight: 700; align-self: center; }
    .percussion { display: grid; grid-template-columns: 120px 1fr 1fr 1fr; gap: 10px; padding: 8px 14px; text-align: center; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; }
    .percussion-label { font-size: clamp(16px, 1.4vw, 22px); font-weight: 700; align-self: center; }
    .percussion-card { display: grid; gap: 4px; align-content: center; justify-items: center; padding: 4px 6px; }
    .percussion-card-label { font-size: clamp(14px, 1.1vw, 16px); color: #aab6cf; text-transform: uppercase; letter-spacing: 0.05em; }
    .percussion-card-value { font-size: clamp(11px, 0.8vw, 14px); color: #d6deee; line-height: 1.15; }
    .metric-card { display: grid; gap: 1px; align-content: center; justify-items: center; padding: 4px 6px; }
    .metric-label { font-size: clamp(14px, 1.25vw, 18px); color: #aab6cf; text-transform: uppercase; letter-spacing: 0.05em; }
    .metric-delta { font-size: clamp(24px, 2.6vw, 40px); line-height: 0.92; font-weight: 800; color: #ddb56b; font-variant-numeric: tabular-nums; }
    .metric-detail { font-size: clamp(11px, 0.9vw, 15px); color: #d6deee; font-variant-numeric: tabular-nums; }
    .rows { display: grid; gap: 8px; min-height: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; }
    .diff-row { grid-template-columns: 70px 1fr 1fr; gap: 6px; padding: 6px 10px; text-align: center; min-height: 0; }
    .row-label { font-size: clamp(16px, 1.35vw, 22px); font-weight: 700; align-self: center; color: #aab6cf; }
  </style>
</head>
<body>
  <div class="screen">
    <div class="header">
      <div class="eyebrow" id="eventName"></div>
      <div class="title">Stage Changeover</div>
    </div>
    <div class="actions">
      <button id="startBtn">Start at First Band</button>
      <button id="prevBtn">Previous Band</button>
      <button id="nextBtn">Advance to Next Band</button>
    </div>
    <div class="bands">
      <div class="band-card">
        <div class="band-label">On Stage</div>
        <div class="band-name" id="currentName"></div>
      </div>
      <div class="arrow">→</div>
      <div class="band-card">
        <div class="band-label">Next Band</div>
        <div class="band-name" id="nextName"></div>
      </div>
    </div>
    <div class="content">
      <div class="totals" id="totals"></div>
      <div class="percussion" id="percussion"></div>
      <div class="rows" id="rows"></div>
    </div>
  </div>
  <script>
    const state = ${payload};
    const byId = (id) => document.getElementById(id);
    const formatSignedDiff = (value) => {
      const n = Number(value || 0);
      if (n > 0) return '+' + n;
      if (n < 0) return String(n);
      return '0';
    };
    const getStageDiffSummary = (currentEntry, nextEntry) => {
      const currentRows = Array.isArray(currentEntry?.seating?.rows) ? currentEntry.seating.rows : [];
      const nextRows = Array.isArray(nextEntry?.seating?.rows) ? nextEntry.seating.rows : [];
      const rowCount = Math.max(currentRows.length, nextRows.length, 6);
      let totalChairDelta = 0;
      let totalStandDelta = 0;
      const rows = [];
      for (let i = 0; i < rowCount; i += 1) {
        const currentRow = currentRows[i] || {};
        const nextRow = nextRows[i] || {};
        const currentChairs = Number(currentRow.chairs || 0);
        const nextChairs = Number(nextRow.chairs || 0);
        const currentStands = Number(currentRow.stands || 0);
        const nextStands = Number(nextRow.stands || 0);
        const chairDelta = nextChairs - currentChairs;
        const standDelta = nextStands - currentStands;
        totalChairDelta += chairDelta;
        totalStandDelta += standDelta;
        rows.push({ rowNumber: i + 1, currentChairs, nextChairs, currentStands, nextStands, chairDelta, standDelta });
      }
      const currentPerc = new Set(Array.isArray(currentEntry?.percussionNeeds?.selected) ? currentEntry.percussionNeeds.selected.filter(Boolean) : []);
      const nextPerc = new Set(Array.isArray(nextEntry?.percussionNeeds?.selected) ? nextEntry.percussionNeeds.selected.filter(Boolean) : []);
      return {
        totalChairDelta,
        totalStandDelta,
        rows,
        percussion: {
          add: Array.from(nextPerc).filter((item) => !currentPerc.has(item)),
          remove: Array.from(currentPerc).filter((item) => !nextPerc.has(item)),
          keep: Array.from(nextPerc).filter((item) => currentPerc.has(item)),
        },
      };
    };
    const render = () => {
      const current = state.rows[state.currentIndex] || null;
      const next = state.rows[state.currentIndex + 1] || null;
      byId('eventName').textContent = state.eventName || 'Stage Flow';
      byId('currentName').textContent = current?.label || 'No band selected';
      byId('nextName').textContent = next?.label || 'End of schedule';
      const diff = getStageDiffSummary(current?.entry || {}, next?.entry || {});
      byId('totals').innerHTML = \`
        <div class="totals-label">Totals</div>
        <div class="metric-card"><div class="metric-label">Chairs</div><div class="metric-delta">\${formatSignedDiff(diff.totalChairDelta)}</div><div class="metric-detail">overall change</div></div>
        <div class="metric-card"><div class="metric-label">Stands</div><div class="metric-delta">\${formatSignedDiff(diff.totalStandDelta)}</div><div class="metric-detail">overall change</div></div>
      \`;
      byId('percussion').innerHTML = \`
        <div class="percussion-label">Percussion</div>
        <div class="percussion-card"><div class="percussion-card-label">Add</div><div class="percussion-card-value">\${diff.percussion.add.length ? diff.percussion.add.join(' • ') : 'None'}</div></div>
        <div class="percussion-card"><div class="percussion-card-label">Remove</div><div class="percussion-card-value">\${diff.percussion.remove.length ? diff.percussion.remove.join(' • ') : 'None'}</div></div>
        <div class="percussion-card"><div class="percussion-card-label">Keep</div><div class="percussion-card-value">\${diff.percussion.keep.length ? diff.percussion.keep.join(' • ') : 'None'}</div></div>
      \`;
      byId('rows').innerHTML = diff.rows.map((row) => \`
        <div class="diff-row">
          <div class="row-label">Row \${row.rowNumber}</div>
          <div class="metric-card">
            <div class="metric-label">Chairs</div>
            <div class="metric-delta">\${formatSignedDiff(row.chairDelta)}</div>
            <div class="metric-detail">\${row.currentChairs} → \${row.nextChairs}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Stands</div>
            <div class="metric-delta">\${formatSignedDiff(row.standDelta)}</div>
            <div class="metric-detail">\${row.currentStands} → \${row.nextStands}</div>
          </div>
        </div>
      \`).join('');
      byId('startBtn').disabled = state.currentIndex <= 0;
      byId('prevBtn').disabled = state.currentIndex <= 0;
      byId('nextBtn').disabled = state.currentIndex >= state.rows.length - 1;
    };
    byId('startBtn').addEventListener('click', () => { state.currentIndex = 0; render(); });
    byId('prevBtn').addEventListener('click', () => { state.currentIndex = Math.max(0, state.currentIndex - 1); render(); });
    byId('nextBtn').addEventListener('click', () => { state.currentIndex = Math.min(state.rows.length - 1, state.currentIndex + 1); render(); });
    render();
  </script>
  </body>
</html>`);
    popup.document.close();
    return true;
  }

  function setAdminStepChip(el, { label, done = false, active = false } = {}) {
    if (!el) return;
    el.textContent = label || "";
    el.classList.toggle("is-done", Boolean(done));
    el.classList.toggle("is-active", Boolean(active));
  }

  function renderAdminLiveWorkflowGuidance({
    hasActiveEvent = false,
    hasScheduled = false,
  } = {}) {
    if (!els.adminLiveWorkflowCard) return;
    let step = "Start";
    let nextTitle = "Set an active event to begin.";
    let nextHint = "Then review the running order and stage flow for scheduled ensembles.";
    let nextActionLabel = "Open Settings";
    let nextAction = () => {
      window.location.hash = "#admin/settings";
    };

    if (hasActiveEvent && !hasScheduled) {
      step = "Schedule";
      nextTitle = "Schedule ensembles to enable Schedule & Flow operations.";
      nextHint = "Stage flow is driven from scheduled performance entries.";
      nextActionLabel = "Open Registrations";
      nextAction = () => {
        window.location.hash = "#admin/registrations";
      };
    } else if (hasActiveEvent && hasScheduled) {
      step = "Stage";
      nextTitle = "Manage stage flow for scheduled ensembles.";
      nextHint = "Use the running order and stage flow tools below.";
      nextActionLabel = "Open Stage Flow";
      nextAction = () => {
        els.liveEventContent?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    }

    if (els.adminLiveCurrentStepPill) els.adminLiveCurrentStepPill.textContent = step;
    if (els.adminLiveNextStepTitle) els.adminLiveNextStepTitle.textContent = nextTitle;
    if (els.adminLiveNextStepHint) els.adminLiveNextStepHint.textContent = nextHint;
    if (els.adminLiveWorkflowActionBtn) {
      els.adminLiveWorkflowActionBtn.textContent = nextActionLabel;
      els.adminLiveWorkflowActionBtn.onclick = (event) => {
        event.preventDefault();
        nextAction?.();
      };
    }

    setAdminStepChip(els.adminLiveStepChipEvent, {
      label: "Event",
      done: hasActiveEvent,
      active: !hasActiveEvent,
    });
    setAdminStepChip(els.adminLiveStepChipQueue, {
      label: "Running Order",
      done: hasScheduled,
      active: hasActiveEvent && hasScheduled,
    });
    setAdminStepChip(els.adminLiveStepChipSetup, {
      label: "Stage Flow",
      done: hasScheduled,
      active: hasActiveEvent && hasScheduled,
    });
  }

  function closeLiveEventCheckinModal() {
    // Schedule & Flow no longer owns check-in interactions.
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
    title.textContent = "Stage Flow View";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Compare the band on stage with the next band to review setup changes and transitions.";
    panel.appendChild(title);
    panel.appendChild(hint);

    const controls = document.createElement("div");
    controls.className = "row";
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "ghost";
    startBtn.textContent = "Start at First Band";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ghost";
    prevBtn.textContent = "Previous Band";
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "Advance to Next Band";
    controls.appendChild(startBtn);
    controls.appendChild(prevBtn);
    controls.appendChild(nextBtn);
    const popoutBtn = document.createElement("button");
    popoutBtn.type = "button";
    popoutBtn.className = "ghost";
    popoutBtn.textContent = "Open Stage Display";
    controls.appendChild(popoutBtn);
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
    const announcerIndex = Number(state.admin.announcerCurrentIndex);
    if (!Number.isInteger(state.admin.liveEventStageIndex) || state.admin.liveEventStageIndex < 0) {
      state.admin.liveEventStageIndex =
        Number.isInteger(announcerIndex) && announcerIndex >= 0 && announcerIndex < sortedRows.length
          ? announcerIndex
          : 0;
    }

    const renderDetail = () => {
      content.innerHTML = "";
      const currentIndex = Math.max(0, Math.min(Number(state.admin.liveEventStageIndex) || 0, sortedRows.length - 1));
      const currentRow = sortedRows[currentIndex] || null;
      const nextRow = sortedRows[currentIndex + 1] || null;
      state.admin.liveEventStageIndex = currentIndex;
      if (!currentRow) {
        status.textContent = "No ensemble selected for stage flow.";
        return;
      }
      const currentLabel = formatSchoolEnsembleLabel({
        schoolName: currentRow.schoolName,
        ensembleName: currentRow.ensembleName,
        ensembleId: currentRow.ensembleId,
      });
      const nextLabel = nextRow
        ? formatSchoolEnsembleLabel({
            schoolName: nextRow.schoolName,
            ensembleName: nextRow.ensembleName,
            ensembleId: nextRow.ensembleId,
          })
        : "No next band scheduled";

      status.textContent = nextRow
        ? `On stage: ${currentLabel} · On deck: ${nextLabel}`
        : `On stage: ${currentLabel} · End of schedule`;
      content.appendChild(buildAdminLogisticsEntryPanel(currentRow.entry || {}, "Band On Stage"));
      if (nextRow) {
        content.appendChild(buildAdminLogisticsEntryPanel(nextRow.entry || {}, "Next Band"));
        content.appendChild(buildAdminLogisticsDiffPanel(currentRow.entry || {}, nextRow.entry || {}));
      } else {
        const done = document.createElement("div");
        done.className = "panel stack";
        done.innerHTML = "<strong>Next Band</strong><div class='note'>No next band is scheduled. You are at the end of the running order.</div>";
        content.appendChild(done);
      }
      prevBtn.disabled = currentIndex <= 0;
      nextBtn.disabled = currentIndex >= sortedRows.length - 1;
      popoutBtn.disabled = !nextRow;
      popoutBtn.onclick = () => {
        if (!nextRow) return;
        const opened = openStageDisplayWindow({
          rows: sortedRows,
          currentIndex,
          eventName: state.event.active?.name || "Stage Flow",
        });
        if (!opened) {
          status.textContent = "Popup blocked. Allow popups for this site, then try Open Stage Display again.";
        }
      };
    };

    startBtn.addEventListener("click", () => {
      state.admin.liveEventStageIndex = 0;
      renderDetail();
    });
    prevBtn.addEventListener("click", () => {
      state.admin.liveEventStageIndex = Math.max(0, (Number(state.admin.liveEventStageIndex) || 0) - 1);
      renderDetail();
    });
    nextBtn.addEventListener("click", () => {
      state.admin.liveEventStageIndex = Math.min(sortedRows.length - 1, (Number(state.admin.liveEventStageIndex) || 0) + 1);
      renderDetail();
    });
    renderDetail();
    parent.appendChild(panel);
  }

  function renderLiveEventCheckinModalBody() {}

  function openLiveEventCheckinModal() {}

  async function renderLiveEventCheckinQueue() {
    if (!els.liveEventContent) return;
    const eventId = state.event.active?.id || "";
    const eventName = state.event.active?.name || "Active Event";
    if (!eventId) {
      els.liveEventContent.innerHTML = "<p class='hint'>Set an active event to view the running order and stage flow.</p>";
      renderAdminLiveWorkflowGuidance({
        hasActiveEvent: false,
      });
      return;
    }
    els.liveEventContent.innerHTML = "<p class='hint'>Loading running order and stage flow...</p>";
    renderAdminLiveWorkflowGuidance({
      hasActiveEvent: true,
      hasScheduled: false,
    });
    try {
      let warningText = "";
      const schedEntries = await fetchScheduleEntries(eventId).catch((error) => {
        console.warn("Schedule & Flow: schedule unavailable", error);
        warningText = "Schedule data is temporarily unavailable.";
        return state.event.rosterEntries || [];
      });
      const regEntries = await fetchRegisteredEnsembles(eventId).catch((error) => {
        console.warn("Schedule & Flow: entry data unavailable", error);
        warningText = warningText
          ? `${warningText} Director entry data is partially unavailable.`
          : "Director entry data is partially unavailable.";
        return [];
      });
      const entryMap = new Map((regEntries || []).map((entry) => [entry.ensembleId || entry.id, entry]));
      const rows = (schedEntries || []).map((sched) => {
        const ensembleId = sched.ensembleId || sched.id;
        const reg = entryMap.get(ensembleId) || {};
        const schoolId = sched.schoolId || reg.schoolId || "";
        const schoolName = sched.schoolName || reg.schoolName || getSchoolNameById(state.admin.schoolsList, reg.schoolId) || "—";
        const ensembleName = normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: sched.ensembleName || reg.ensembleName || "",
          ensembleId,
        }) || "—";
        const grade = reg.declaredGradeLevel || reg.performanceGrade || "—";
        const perfAt = toDateOrNull(sched.performanceAt);
        return {
          ensembleId,
          schoolId,
          schoolName,
          ensembleName,
          grade,
          performanceAt: perfAt,
          entry: reg,
        };
      }).sort((a, b) => {
        const aTime = a.performanceAt?.getTime?.() || 0;
        const bTime = b.performanceAt?.getTime?.() || 0;
        return aTime - bTime;
      });

      if (!rows.length) {
        els.liveEventContent.innerHTML = `<p class='hint'>${escapeHtml(eventName)} has no scheduled ensembles yet.</p>`;
        renderAdminLiveWorkflowGuidance({
          hasActiveEvent: true,
          hasScheduled: false,
        });
        return;
      }
      renderAdminLiveWorkflowGuidance({
        hasActiveEvent: true,
        hasScheduled: true,
      });

      const wrap = document.createElement("div");
      wrap.className = "stack";
      const meta = document.createElement("div");
      meta.className = "note admin-live-queue-meta";
      meta.textContent = `Running Order · ${eventName}`;
      wrap.appendChild(meta);
      if (warningText) {
        const warn = document.createElement("div");
        warn.className = "hint";
        warn.textContent = warningText;
        wrap.appendChild(warn);
      }
      const tableWrap = document.createElement("div");
      tableWrap.className = "schedule-timeline-table-wrap admin-live-queue-table";
      const table = document.createElement("table");
      table.className = "schedule-timeline-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Time</th>
            <th>School</th>
            <th>Ensemble</th>
            <th>Grade</th>
          </tr>
        </thead>
      `;
      const tbody = document.createElement("tbody");
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(formatStartTime(row.performanceAt))}</td>
          <td>${escapeHtml(row.schoolName)}</td>
          <td>${escapeHtml(row.ensembleName)}</td>
          <td>${escapeHtml(row.grade)}</td>
        `;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);
      renderLiveEventStageSetup(wrap, rows);
      els.liveEventContent.innerHTML = "";
      els.liveEventContent.appendChild(wrap);
    } catch (error) {
      console.error("renderScheduleAndFlow failed", error);
      const message = error?.message || error?.code || "unknown error";
      els.liveEventContent.innerHTML = `<p class='hint'>Unable to load schedule and flow right now. (${escapeHtml(String(message))})</p>`;
      renderAdminLiveWorkflowGuidance({
        hasActiveEvent: Boolean(eventId),
      });
    }
  }

  return {
    renderLiveEventCheckinQueue,
    closeLiveEventCheckinModal,
    openLiveEventCheckinModal,
    renderLiveEventCheckinModalBody,
  };
}
