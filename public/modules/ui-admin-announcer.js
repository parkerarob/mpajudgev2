export function createAdminAnnouncerController({
  els,
  state,
  db,
  COLLECTIONS,
  collection,
  getDocs,
  query,
  fetchScheduleEntries,
  fetchRegisteredEnsembles,
  getSchoolNameById,
  normalizeEnsembleDisplayName,
  toDateOrNull,
  escapeHtml,
  formatStartTime,
} = {}) {
  function formatSchoolEnsembleLabel(row = {}) {
    return [row.schoolName, row.ensembleName].filter(Boolean).join(" - ").trim() || "Unknown ensemble";
  }

  function openStageDisplayWindow({ rows = [], currentIndex = 0, eventName }) {
    const popup = window.open("", "_blank", "popup,width=1440,height=900");
    if (!popup) return false;
    const stageRows = rows.map((row) => ({
      label: formatSchoolEnsembleLabel(row),
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
    body { margin: 0; min-height: 100vh; background: #07111d; color: #f5f7fb; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .screen { width: min(95vw, 1720px); height: min(95vh, calc(95vw * 9 / 16)); padding: 18px 24px; display: grid; grid-template-rows: auto auto 1fr; gap: 12px; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), #0d1726; border: 1px solid rgba(255,255,255,0.08); border-radius: 28px; box-shadow: 0 32px 80px rgba(0,0,0,0.35); overflow: hidden; }
    .header, .bands, .totals, .diff-row { display: grid; align-items: center; }
    .header { text-align: center; gap: 4px; }
    .eyebrow { font-size: clamp(14px, 1.3vw, 18px); letter-spacing: 0.08em; text-transform: uppercase; color: #aab6cf; }
    .title { font-size: clamp(24px, 2.4vw, 38px); font-weight: 700; }
    .actions { display: flex; justify-content: center; gap: 10px; }
    .actions button { font: inherit; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: #f5f7fb; border-radius: 12px; padding: 8px 14px; cursor: pointer; }
    .actions button:disabled { opacity: 0.4; cursor: default; }
    .bands { grid-template-columns: 1fr auto 1fr; gap: 12px; text-align: center; }
    .band-card, .totals, .diff-row { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; }
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
    <div class="header"><div class="eyebrow" id="eventName"></div><div class="title">Stage Changeover</div></div>
    <div class="actions"><button id="startBtn">Start at First Band</button><button id="prevBtn">Previous Band</button><button id="nextBtn">Advance to Next Band</button></div>
    <div class="bands">
      <div class="band-card"><div class="band-label">On Stage</div><div class="band-name" id="currentName"></div></div>
      <div class="arrow">→</div>
      <div class="band-card"><div class="band-label">Next Band</div><div class="band-name" id="nextName"></div></div>
    </div>
    <div class="content"><div class="totals" id="totals"></div><div class="percussion" id="percussion"></div><div class="rows" id="rows"></div></div>
  </div>
  <script>
    const state = ${payload};
    const byId = (id) => document.getElementById(id);
    const formatSignedDiff = (value) => { const n = Number(value || 0); if (n > 0) return '+' + n; if (n < 0) return String(n); return '0'; };
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
      return { totalChairDelta, totalStandDelta, rows, percussion: { add: Array.from(nextPerc).filter((item) => !currentPerc.has(item)), remove: Array.from(currentPerc).filter((item) => !nextPerc.has(item)), keep: Array.from(nextPerc).filter((item) => currentPerc.has(item)) } };
    };
    const render = () => {
      const current = state.rows[state.currentIndex] || null;
      const next = state.rows[state.currentIndex + 1] || null;
      byId('eventName').textContent = state.eventName || 'Stage Flow';
      byId('currentName').textContent = current?.label || 'No band selected';
      byId('nextName').textContent = next?.label || 'End of schedule';
      const diff = getStageDiffSummary(current?.entry || {}, next?.entry || {});
      byId('totals').innerHTML = '<div class="totals-label">Totals</div><div class="metric-card"><div class="metric-label">Chairs</div><div class="metric-delta">' + formatSignedDiff(diff.totalChairDelta) + '</div><div class="metric-detail">overall change</div></div><div class="metric-card"><div class="metric-label">Stands</div><div class="metric-delta">' + formatSignedDiff(diff.totalStandDelta) + '</div><div class="metric-detail">overall change</div></div>';
      byId('percussion').innerHTML = '<div class="percussion-label">Percussion</div><div class="percussion-card"><div class="percussion-card-label">Add</div><div class="percussion-card-value">' + (diff.percussion.add.length ? diff.percussion.add.join(' • ') : 'None') + '</div></div><div class="percussion-card"><div class="percussion-card-label">Remove</div><div class="percussion-card-value">' + (diff.percussion.remove.length ? diff.percussion.remove.join(' • ') : 'None') + '</div></div><div class="percussion-card"><div class="percussion-card-label">Keep</div><div class="percussion-card-value">' + (diff.percussion.keep.length ? diff.percussion.keep.join(' • ') : 'None') + '</div></div>';
      byId('rows').innerHTML = diff.rows.map((row) => '<div class="diff-row"><div class="row-label">Row ' + row.rowNumber + '</div><div class="metric-card"><div class="metric-label">Chairs</div><div class="metric-delta">' + formatSignedDiff(row.chairDelta) + '</div><div class="metric-detail">' + row.currentChairs + ' → ' + row.nextChairs + '</div></div><div class="metric-card"><div class="metric-label">Stands</div><div class="metric-delta">' + formatSignedDiff(row.standDelta) + '</div><div class="metric-detail">' + row.currentStands + ' → ' + row.nextStands + '</div></div></div>').join('');
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

  function bindAnnouncerWorkflowActions() {
    els.adminAnnouncerContent?.querySelectorAll?.("[data-announcer-nav]")?.forEach((button) => {
      button.addEventListener("click", () => {
        const target = String(button.getAttribute("data-announcer-nav") || "").trim();
        if (!target) return;
        window.location.hash = target;
      });
    });
    els.adminAnnouncerContent?.querySelectorAll?.("[data-announcer-retry]")?.forEach((button) => {
      button.addEventListener("click", () => {
        void renderAdminAnnouncerView();
      });
    });
  }

  function formatDateHeading(dateLike) {
    const date = toDateOrNull(dateLike);
    if (!date) return "Date TBD";
    return date.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function getGreetingPeriod(dateLike) {
    const date = toDateOrNull(dateLike) || new Date();
    return date.getHours() < 12 ? "morning" : "afternoon";
  }

  function romanToArabicGrade(value = "") {
    const text = String(value || "").trim().toUpperCase();
    const map = {
      I: "1",
      II: "2",
      III: "3",
      IV: "4",
      V: "5",
      VI: "6",
    };
    if (!text) return "";
    if (text.includes("/")) {
      return text
        .split("/")
        .map((part) => map[part.trim()] || part.trim())
        .join("/");
    }
    return map[text] || text;
  }

  function formatPiece(piece = {}) {
    const title = String(piece?.title || "").trim();
    const composer = String(piece?.composer || "").trim();
    if (!title) return "";
    let line = title;
    if (composer) line += ` by ${composer}`;
    return line;
  }

  function buildProgramLines(entry = {}) {
    const repertoire = entry?.repertoire || {};
    const lines = [];
    const march = formatPiece(repertoire.march);
    const selection1 = formatPiece(repertoire.selection1);
    const selection2 = formatPiece(repertoire.selection2);
    if (march) lines.push(march);
    if (selection1) lines.push(selection1);
    if (selection2) lines.push(selection2);
    return lines;
  }

  function buildSegmentIntroScript(eventName, currentPerformanceAt) {
    return [
      `Good ${getGreetingPeriod(currentPerformanceAt)} and welcome to the North Carolina Bandmasters Association Music Performance Adjudication.`,
      `We are honored to host ${eventName}, where student musicians from across the region showcase their dedication, artistry, and musicianship in a formal performance setting.`,
      "The Music Performance Adjudication, or MPA, provides ensembles with an opportunity to receive feedback from experienced adjudicators, helping to guide their continued musical growth.",
      "We thank all of the directors, students, families, supporters, and adjudicators who make this event possible.",
      "We ask that you please silence all electronic devices and remain seated during each performance to respect the hard work of these students.",
      "Thank you for being part of this special event, and we hope you enjoy a day filled with outstanding performances.",
    ].join("\n\n");
  }

  function buildAnnouncementScript(row) {
    const lines = [];
    const ensembleRef = [row.schoolName, row.ensembleName].filter(Boolean).join(" ").trim() || "this ensemble";
    const directorPart = row.directorName ? `, under the direction of ${row.directorName}` : "";
    const announcedProgramLines = (row.programLines || []).map((line, index, arr) =>
      arr.length > 1 && index === arr.length - 1 ? `and ${line}` : line
    );
    lines.push(`Up next, we have the ${ensembleRef}${directorPart}.`);
    if (row.gradeLabel) {
      lines.push(`Their Grade ${romanToArabicGrade(row.gradeLabel)} performance includes:`);
    } else if (announcedProgramLines.length) {
      lines.push("Their performance includes:");
    }
    announcedProgramLines.forEach((line) => {
      lines.push(line);
    });
    lines.push("");
    lines.push(
      `The North Carolina Bandmasters Association proudly presents the ${ensembleRef} for their MPA performance.`
    );
    return lines.join("\n");
  }

  function resolveCurrentIndex(rows = []) {
    if (!rows.length) return -1;
    const currentIndex = Number(state.admin.announcerCurrentIndex);
    if (Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < rows.length) {
      return currentIndex;
    }
    const nowMs = Date.now();
    const nextIndex = rows.findIndex((row) => (row.performanceAt?.getTime?.() || 0) >= nowMs);
    return nextIndex >= 0 ? nextIndex : 0;
  }

  function bindAnnouncerControls(rows, eventName) {
    const prevBtn = els.adminAnnouncerContent?.querySelector?.("[data-announcer-action='prev']");
    const nextBtn = els.adminAnnouncerContent?.querySelector?.("[data-announcer-action='next']");
    const stageDisplayBtn = els.adminAnnouncerContent?.querySelector?.("[data-announcer-action='stage-display']");
    prevBtn?.addEventListener("click", () => {
      state.admin.announcerCurrentIndex = Math.max(0, resolveCurrentIndex(rows) - 1);
      renderAnnouncerContent(rows, eventName);
    });
    nextBtn?.addEventListener("click", () => {
      state.admin.announcerCurrentIndex = Math.min(rows.length - 1, resolveCurrentIndex(rows) + 1);
      renderAnnouncerContent(rows, eventName);
    });
    stageDisplayBtn?.addEventListener("click", () => {
      const opened = openStageDisplayWindow({
        rows,
        currentIndex: Math.max(0, resolveCurrentIndex(rows)),
        eventName,
      });
      if (!opened) {
        const status = els.adminAnnouncerContent?.querySelector?.("[data-announcer-stage-status]");
        if (status) status.textContent = "Popup blocked. Allow popups for this site, then try Open Stage Display again.";
      }
    });
    els.adminAnnouncerContent?.querySelectorAll?.("[data-announcer-index]")?.forEach((button) => {
      button.addEventListener("click", () => {
        state.admin.announcerCurrentIndex = Number(button.getAttribute("data-announcer-index") || 0);
        renderAnnouncerContent(rows, eventName);
      });
    });
  }

  function renderAnnouncerContent(rows, eventName) {
    if (!els.adminAnnouncerContent) return;
    if (!rows.length) {
      els.adminAnnouncerContent.innerHTML = `
        <div class="empty stack">
          <div>${escapeHtml(eventName)} has no scheduled ensembles yet.</div>
          <div class="hint">Add scheduled ensembles first, then return here for announcer scripts and stage flow.</div>
          <div class="actions">
            <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/event-day">Open Event Day</button>
            <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/pre-event">Open Pre-Event</button>
          </div>
        </div>
      `;
      bindAnnouncerWorkflowActions();
      return;
    }

    const currentIndex = resolveCurrentIndex(rows);
    state.admin.announcerCurrentIndex = currentIndex;
    const featuredRow = rows[currentIndex];
    const nextRow = rows[currentIndex + 1] || null;
    const grouped = new Map();
    rows.forEach((row, index) => {
      const key = formatDateHeading(row.performanceAt);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ ...row, announcerIndex: index });
    });

    const featuredScript = buildAnnouncementScript(featuredRow);
    const nextScript = nextRow ? buildAnnouncementScript(nextRow) : "No next script available.";
    const introScript = buildSegmentIntroScript(eventName, featuredRow?.performanceAt);

    const groupHtml = Array.from(grouped.entries())
      .map(([heading, items]) => {
        const cards = items
          .map((row) => {
            const programHtml = row.programLines.length
              ? `<ul class="announcer-program-list">${row.programLines
                  .map((line) => `<li>${escapeHtml(line)}</li>`)
                  .join("")}</ul>`
              : "<div class='hint'>No repertoire submitted yet.</div>";
            const isCurrent = row.announcerIndex === currentIndex;
            return `
              <article class="announcer-card${isCurrent ? " is-current" : ""}">
                <div class="announcer-card-top">
                  <div>
                    <div class="announcer-card-time">${escapeHtml(formatStartTime(row.performanceAt))}</div>
                    <h4>${escapeHtml(row.schoolName)} - ${escapeHtml(row.ensembleName)}</h4>
                  </div>
                  <div class="announcer-card-meta">
                    ${row.gradeLabel ? `<span class="badge">Grade ${escapeHtml(row.gradeLabel)}</span>` : ""}
                  </div>
                </div>
                <div class="announcer-script">${escapeHtml(buildAnnouncementScript(row))}</div>
                <div class="announcer-detail-grid">
                  <div><strong>Director:</strong> ${escapeHtml(row.directorName || "Not listed")}</div>
                  <div><strong>Performance:</strong> ${escapeHtml(formatStartTime(row.performanceAt))}</div>
                </div>
                <div class="announcer-program-block">
                  <strong>Program</strong>
                  ${programHtml}
                </div>
                <div class="row">
                  <button type="button" class="ghost" data-announcer-index="${row.announcerIndex}">
                    ${isCurrent ? "Current Band" : "Make Current"}
                  </button>
                </div>
              </article>
            `;
          })
          .join("");
        return `
          <section class="announcer-day-group">
            <div class="announcer-day-heading">${escapeHtml(heading)}</div>
            <div class="announcer-card-list">${cards}</div>
          </section>
        `;
      })
      .join("");

    els.adminAnnouncerContent.innerHTML = `
      <div class="announcer-shell">
        <section class="announcer-feature-card">
          <div class="eyebrow">Segment Start Script</div>
          <div class="announcer-script announcer-script--feature">${escapeHtml(introScript)}</div>
        </section>
        <div class="announcer-progress-bar">
          <div class="announcer-progress-meta">
            <div class="eyebrow">Current Band</div>
            <strong>${escapeHtml(featuredRow.schoolName)} - ${escapeHtml(featuredRow.ensembleName)}</strong>
            <div class="note">${currentIndex + 1} of ${rows.length}</div>
          </div>
          <div class="row">
            <button type="button" class="ghost" data-announcer-action="prev" ${currentIndex <= 0 ? "disabled" : ""}>Previous Band</button>
            <button type="button" class="ghost" data-announcer-action="stage-display" ${rows.length < 2 || currentIndex >= rows.length - 1 ? "disabled" : ""}>Open Stage Display</button>
            <button type="button" data-announcer-action="next" ${currentIndex >= rows.length - 1 ? "disabled" : ""}>Advance to Next Band</button>
          </div>
        </div>
        <div class="announcer-feature-grid">
          <section class="announcer-feature-card">
            <div class="eyebrow">Current Script</div>
            <h4>${escapeHtml(featuredRow.schoolName)} - ${escapeHtml(featuredRow.ensembleName)}</h4>
            <div class="note">${escapeHtml(formatDateHeading(featuredRow.performanceAt))} at ${escapeHtml(formatStartTime(featuredRow.performanceAt))}</div>
            <div class="announcer-script announcer-script--feature">${escapeHtml(featuredScript)}</div>
          </section>
          <section class="announcer-feature-card">
            <div class="eyebrow">On Deck</div>
            <h4>${escapeHtml(nextRow ? `${nextRow.schoolName} - ${nextRow.ensembleName}` : "No later ensemble scheduled")}</h4>
            <div class="note">${nextRow ? `${escapeHtml(formatDateHeading(nextRow.performanceAt))} at ${escapeHtml(formatStartTime(nextRow.performanceAt))}` : "You are at the end of the schedule."}</div>
            <div class="announcer-script announcer-script--feature">${escapeHtml(nextScript)}</div>
          </section>
        </div>
        <div class="note" data-announcer-stage-status>Use Open Stage Display here for the on-stage / on-deck setup view.</div>
        <div class="note">Showing ${rows.length} scheduled ensemble${rows.length === 1 ? "" : "s"} for ${escapeHtml(eventName)}.</div>
        ${groupHtml}
      </div>
    `;
    bindAnnouncerControls(rows, eventName);
  }

  async function renderAdminAnnouncerView() {
    if (!els.adminAnnouncerContent) return;
    const eventId = state.event.active?.id || "";
    const eventName = state.event.active?.name || "Active Event";
    if (!eventId) {
      state.admin.announcerRows = [];
      state.admin.announcerCurrentIndex = -1;
      state.admin.announcerEventId = "";
      els.adminAnnouncerContent.innerHTML =
        `
          <div class="empty stack">
            <div>Set an active event to load announcer notes.</div>
            <div class="hint">The announcer workspace follows the active event schedule.</div>
            <div class="actions">
              <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/setup">Open Settings</button>
            </div>
          </div>
        `;
      bindAnnouncerWorkflowActions();
      return;
    }

    els.adminAnnouncerContent.innerHTML = "<p class='hint'>Loading announcer notes...</p>";
    try {
      const [schedEntries, regEntries, directorsSnap] = await Promise.all([
        fetchScheduleEntries(eventId),
        fetchRegisteredEnsembles(eventId),
        getDocs(query(collection(db, COLLECTIONS.users))),
      ]);

      const entryMap = new Map((regEntries || []).map((entry) => [entry.ensembleId || entry.id, entry]));
      const directorsBySchool = new Map();
      directorsSnap.forEach((snap) => {
        const data = snap.data() || {};
        const isDirectorCapable = data.role === "director" || data.roles?.director === true;
        if (!isDirectorCapable) return;
        const schoolId = String(data.schoolId || "").trim();
        if (!schoolId || directorsBySchool.has(schoolId)) return;
        directorsBySchool.set(schoolId, {
          displayName: String(data.displayName || "").trim(),
          email: String(data.email || "").trim(),
        });
      });

      const rows = (schedEntries || [])
        .map((sched) => {
          const ensembleId = sched.ensembleId || sched.id;
          const entry = entryMap.get(ensembleId) || {};
          const schoolId = sched.schoolId || entry.schoolId || "";
          const schoolName =
            sched.schoolName ||
            entry.schoolName ||
            getSchoolNameById(state.admin.schoolsList, schoolId) ||
            schoolId ||
            "Unknown school";
          const ensembleName =
            normalizeEnsembleDisplayName({
              schoolName,
              ensembleName: sched.ensembleName || entry.ensembleName || "",
              ensembleId,
            }) || "Unknown ensemble";
          const directorProfile = directorsBySchool.get(schoolId) || {};
          const directorName = directorProfile.displayName || directorProfile.email || "";
          const grade = String(entry.declaredGradeLevel || entry.performanceGrade || "").trim();
          const gradeLabel = grade
            ? `${grade}${entry.declaredGradeFlex || entry.performanceGradeFlex ? "-Flex" : ""}`
            : "";
          return {
            ensembleId,
            schoolId,
            schoolName,
            ensembleName,
            directorName,
            gradeLabel,
            performanceAt: toDateOrNull(sched.performanceAt),
            programLines: buildProgramLines(entry),
            entry,
          };
        })
        .sort((a, b) => {
          const aTime = a.performanceAt?.getTime?.() || 0;
          const bTime = b.performanceAt?.getTime?.() || 0;
          return aTime - bTime;
        });

      if (state.admin.announcerEventId !== eventId) {
        state.admin.announcerCurrentIndex = -1;
      }
      state.admin.announcerEventId = eventId;
      state.admin.announcerRows = rows;
      renderAnnouncerContent(rows, eventName);
    } catch (error) {
      const message = error?.message || "Unable to load announcer notes.";
      els.adminAnnouncerContent.innerHTML = `
        <div class="empty stack">
          <div>${escapeHtml(String(message))}</div>
          <div class="actions">
            <button type="button" class="ghost btn--sm" data-announcer-retry="1">Retry Announcer</button>
            <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/event-day">Open Event Day</button>
          </div>
        </div>
      `;
      bindAnnouncerWorkflowActions();
    }
  }

  return {
    renderAdminAnnouncerView,
  };
}
