export function createCheckinView({
  els,
  state,
  db,
  COLLECTIONS,
  FIELDS,
  STANDARD_INSTRUMENTS,
  PERCUSSION_OPTIONS,
  REPERTOIRE_FIELDS,
  collection,
  getDocs,
  getDocsFromServer,
  query,
  where,
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
  updateEntryCheckinFields,
  updateEntryFields,
} = {}) {
  let initialized = false;
  const SLOT_MINUTES_BY_GRADE = {
    I: 25,
    II: 25,
    III: 30,
    IV: 30,
    V: 35,
    VI: 40,
  };

  function getSlotMinutesForGrade(grade) {
    const raw = String(grade || "").trim().toUpperCase();
    if (!raw) return 30;
    if (SLOT_MINUTES_BY_GRADE[raw]) return SLOT_MINUTES_BY_GRADE[raw];
    if (raw.includes("/")) {
      const parts = raw.split("/");
      if (SLOT_MINUTES_BY_GRADE[parts[1]]) return SLOT_MINUTES_BY_GRADE[parts[1]];
      if (SLOT_MINUTES_BY_GRADE[parts[0]]) return SLOT_MINUTES_BY_GRADE[parts[0]];
    }
    return 30;
  }

  function deriveCheckinTimes(performanceAt, grade) {
    const performance = toDateOrNull(performanceAt);
    if (!performance) {
      return { holdingStart: null, warmUpStart: null, performanceStart: null };
    }
    const slotMinutes = getSlotMinutesForGrade(grade);
    const warmUpStart = new Date(performance.getTime() - slotMinutes * 60 * 1000);
    const holdingStart = new Date(warmUpStart.getTime() - slotMinutes * 60 * 1000);
    return {
      holdingStart,
      warmUpStart,
      performanceStart: performance,
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;
    if (els.checkinQueueFilter) {
      els.checkinQueueFilter.addEventListener("change", () => {
        state.checkin.queueFilter = els.checkinQueueFilter.value || "all";
        renderQueue();
      });
    }
    if (els.checkinBackToQueueBtn) {
      els.checkinBackToQueueBtn.addEventListener("click", () => {
        state.checkin.selectedEnsembleId = null;
        state.checkin.entryDraft = null;
        showQueue();
      });
    }
  }

  function showQueue() {
    if (els.checkinQueuePanel) els.checkinQueuePanel.classList.remove("is-hidden");
    if (els.checkinDetailPanel) els.checkinDetailPanel.classList.add("is-hidden");
    renderQueue();
  }

  function showDetail() {
    if (els.checkinQueuePanel) els.checkinQueuePanel.classList.add("is-hidden");
    if (els.checkinDetailPanel) els.checkinDetailPanel.classList.remove("is-hidden");
  }

  function formatDateShort(dateLike) {
    const d = toDateOrNull(dateLike);
    if (!d) return "\u2014";
    return d.toLocaleDateString();
  }

  // ── Queue ──

  async function renderQueue() {
    if (!els.checkinQueueBody) return;
    const eventId = state.event.active?.id || "";
    const eventName = state.event.active?.name || "Active Event";
    if (!eventId) {
      els.checkinQueueBody.innerHTML = "<p class='hint'>No active event set. An admin must set an active event before check-in can begin.</p>";
      return;
    }
    els.checkinQueueBody.innerHTML = "<p class='hint'>Loading check-in queue\u2026</p>";
    try {
      const scheduleRef = collection(db, COLLECTIONS.events, eventId, COLLECTIONS.schedule);
      const entriesRef = collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries);
      const usersRef = collection(db, COLLECTIONS.users);
      const [schedSnap, entriesSnap, dirByRoleSnap, dirByFlagSnap] = await Promise.all([
        getDocsFromServer(query(scheduleRef)).catch(() => null),
        getDocsFromServer(query(entriesRef)).catch(() => null),
        getDocsFromServer(query(usersRef, where(FIELDS.users.role, "==", "director"))).catch(() => null),
        getDocsFromServer(query(usersRef, where("roles.director", "==", true))).catch(() => null),
      ]);
      const schedEntries = (schedSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }))
        .filter((entry) => entry.hidden !== true)
        .sort((a, b) => {
          const aMs = a.performanceAt?.toMillis?.() ?? (a.performanceAt instanceof Date ? a.performanceAt.getTime() : null) ?? Infinity;
          const bMs = b.performanceAt?.toMillis?.() ?? (b.performanceAt instanceof Date ? b.performanceAt.getTime() : null) ?? Infinity;
          return aMs - bMs;
        });
      const regEntries = (entriesSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
      const entryMap = new Map((regEntries || []).map((e) => [e.ensembleId || e.id, e]));
      // Merge both director queries (by role field and by roles.director flag), dedup by uid
      const allDirectorDocs = new Map();
      [dirByRoleSnap, dirByFlagSnap].forEach((snap) => {
        snap?.forEach((d) => { if (!allDirectorDocs.has(d.id)) allDirectorDocs.set(d.id, d); });
      });
      const directorsBySchool = new Map();
      allDirectorDocs.forEach((snap) => {
        const data = snap.data() || {};
        if (data.role !== "director" && !data.roles?.director) return;
        const sid = data.schoolId || "";
        if (!sid || directorsBySchool.has(sid)) return;
        directorsBySchool.set(sid, {
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
        const schoolName = sched.schoolName || reg.schoolName || getSchoolNameById(state.admin.schoolsList, reg.schoolId) || "\u2014";
        const ensembleName = normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: sched.ensembleName || reg.ensembleName || "",
          ensembleId,
        }) || "\u2014";
        const grade = reg.declaredGradeLevel || reg.performanceGrade || "\u2014";
        const perfAt = toDateOrNull(sched.performanceAt);
        const checkin = computeEnsembleCheckinStatus({ entry: reg, directorProfile });
        const times = deriveCheckinTimes(perfAt, grade);
        return {
          ensembleId,
          schoolId,
          schoolName,
          ensembleName,
          grade,
          performanceAt: perfAt,
          holdingStart: times.holdingStart,
          warmUpStart: times.warmUpStart,
          performStart: times.performanceStart,
          entry: reg,
          directorProfile,
          checkin,
          checkedIn: checkin.checkedIn,
        };
      }).sort((a, b) => (a.performanceAt?.getTime?.() || 0) - (b.performanceAt?.getTime?.() || 0));

      state.checkin.queueRows = rows;

      if (!rows.length) {
        els.checkinQueueBody.innerHTML = `<p class='hint'>${escapeHtml(eventName)} has no scheduled ensembles yet.</p>`;
        return;
      }

      const filter = state.checkin.queueFilter || "all";
      if (els.checkinQueueFilter) els.checkinQueueFilter.value = filter;
      const filtered = rows.filter((r) => {
        if (filter === "not-checked-in") return !r.checkedIn;
        if (filter === "checked-in") return r.checkedIn;
        return true;
      });

      const checkedInCount = rows.filter((r) => r.checkedIn).length;
      const wrap = document.createElement("div");
      wrap.className = "stack";

      const summary = document.createElement("div");
      summary.className = "checkin-queue-summary";
      summary.textContent = `${checkedInCount} of ${rows.length} ensembles checked in`;
      wrap.appendChild(summary);

      if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No ensembles match this filter.";
        wrap.appendChild(empty);
        els.checkinQueueBody.innerHTML = "";
        els.checkinQueueBody.appendChild(wrap);
        return;
      }

      const table = document.createElement("table");
      table.className = "schedule-timeline-table";
      table.innerHTML = `<thead><tr><th>Holding</th><th>Warm-up</th><th>Performance</th><th>School</th><th>Ensemble</th><th>Grade</th><th>Status</th><th></th></tr></thead>`;
      const tbody = document.createElement("tbody");
      filtered.forEach((row) => {
        const tr = document.createElement("tr");
        if (row.checkedIn) tr.classList.add("is-checked-in");
        const progress = computeEnsembleCheckinProgress(row.checkin);
        const statusLabel = row.checkedIn
          ? "\u2713 Checked In"
          : `${progress.completed}/${progress.total}`;
        tr.innerHTML = `
          <td>${escapeHtml(formatStartTime(row.holdingStart))}</td>
          <td>${escapeHtml(formatStartTime(row.warmUpStart))}</td>
          <td>${escapeHtml(formatStartTime(row.performStart))}</td>
          <td>${escapeHtml(row.schoolName)}</td>
          <td>${escapeHtml(row.ensembleName)}</td>
          <td>${escapeHtml(row.grade)}</td>
          <td class="${row.checkedIn ? "checkin-status-done" : "checkin-status-pending"}">${escapeHtml(statusLabel)}</td>
        `;
        const actionTd = document.createElement("td");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn--secondary";
        btn.textContent = row.checkedIn ? "Review" : "Check In";
        btn.addEventListener("click", () => openDetail(row));
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const tableWrap = document.createElement("div");
      tableWrap.className = "schedule-timeline-table-wrap";
      tableWrap.appendChild(table);
      wrap.appendChild(tableWrap);

      els.checkinQueueBody.innerHTML = "";
      els.checkinQueueBody.appendChild(wrap);
    } catch (error) {
      console.error("renderCheckinQueue failed", error);
      els.checkinQueueBody.innerHTML = `<p class='hint'>Unable to load check-in queue. (${escapeHtml(String(error?.message || "unknown"))})</p>`;
    }
  }

  // ── Detail ──

  function openDetail(row) {
    state.checkin.selectedEnsembleId = row.ensembleId;
    state.checkin.entryDraft = JSON.parse(JSON.stringify(row.entry || {}));
    showDetail();
    renderDetail(row);
  }

  function renderDetail(row) {
    if (!els.checkinDetailBody) return;
    els.checkinDetailBody.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "checkin-detail-header";
    const checkin = computeEnsembleCheckinStatus({ entry: row.entry || {}, directorProfile: row.directorProfile || {} });
    const dirName = row.directorProfile?.displayName || row.directorProfile?.email || "No director on file";
    const nafmeStatus = checkin.nafmeValidFromProfile
      ? "Valid from profile \u2713"
      : checkin.nafmeManualVerified
        ? "Manually verified \u2713"
        : "Missing/Expired";
    header.innerHTML = `
      <div class="checkin-detail-title">
        <h3>${escapeHtml(row.schoolName)} \u2014 ${escapeHtml(row.ensembleName)}</h3>
        <span class="badge ${checkin.checkedIn ? "badge--success" : ""}">${checkin.checkedIn ? "Checked In \u2713" : "Not Checked In"}</span>
      </div>
      <div class="checkin-detail-meta">
        <span><strong>Holding:</strong> ${escapeHtml(formatStartTime(row.holdingStart))}</span>
        <span><strong>Warm-up:</strong> ${escapeHtml(formatStartTime(row.warmUpStart))}</span>
        <span><strong>Performance:</strong> ${escapeHtml(formatStartTime(row.performStart))}</span>
        <span><strong>Grade:</strong> ${escapeHtml(row.grade)}</span>
        <span><strong>Director:</strong> ${escapeHtml(dirName)}</span>
        <span><strong>NAfME:</strong> ${escapeHtml(nafmeStatus)}</span>
        ${row.directorProfile?.nafmeMembershipNumber ? `<span><strong>Membership #:</strong> ${escapeHtml(row.directorProfile.nafmeMembershipNumber)}</span>` : ""}
        ${row.directorProfile?.nafmeMembershipExp ? `<span><strong>Expires:</strong> ${escapeHtml(formatDateShort(row.directorProfile.nafmeMembershipExp))}</span>` : ""}
        ${row.directorProfile?.cellPhone ? `<span><strong>Phone:</strong> ${escapeHtml(row.directorProfile.cellPhone)}</span>` : ""}
      </div>
    `;
    if (row.directorProfile?.nafmeCardImageUrl) {
      const cardBtn = document.createElement("button");
      cardBtn.type = "button";
      cardBtn.className = "ghost btn--sm";
      cardBtn.textContent = "View NAfME Card Image";
      cardBtn.addEventListener("click", () => window.open(row.directorProfile.nafmeCardImageUrl, "_blank", "noopener,noreferrer"));
      header.querySelector(".checkin-detail-meta").appendChild(cardBtn);
    }
    els.checkinDetailBody.appendChild(header);

    // Checklist
    const checklistCard = document.createElement("div");
    checklistCard.className = "panel checkin-checklist-card";
    const checklistTitle = document.createElement("h4");
    checklistTitle.textContent = "Check-In Checklist";
    checklistCard.appendChild(checklistTitle);
    renderChecklist(checklistCard, row, checkin);
    els.checkinDetailBody.appendChild(checklistCard);

    // Form sections
    renderFormSections(row);
  }

  function renderChecklist(container, row, checkin) {
    const listEl = container.querySelector(".checkin-checklist-items") || document.createElement("div");
    listEl.className = "checkin-checklist-items stack";
    listEl.innerHTML = "";

    const checks = [
      {
        key: "checkinNafmeManualVerified",
        label: checkin.nafmeValidFromProfile
          ? "NAfME membership verified (auto from profile)"
          : "NAfME membership verified (manual override)",
        checked: checkin.nafmeValid,
        disabled: checkin.nafmeValidFromProfile,
      },
      { key: "checkinScoresReceived", label: "Judge scores received at registration", checked: Boolean(row.entry?.checkinScoresReceived) },
      { key: "checkinChangesReviewed", label: "Director asked about ensemble changes", checked: Boolean(row.entry?.checkinChangesReviewed) },
    ];
    if (checkin.lunchRequired) {
      checks.push({ key: "checkinLunchConfirmed", label: "Pizza order confirmed with director", checked: Boolean(row.entry?.checkinLunchConfirmed) });
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
        const next = input.checked;
        input.disabled = true;
        try {
          await updateEntryCheckinFields(state.event.active?.id, row.ensembleId, { [item.key]: next });
          row.entry = { ...(row.entry || {}), [item.key]: next };
          state.checkin.entryDraft = JSON.parse(JSON.stringify(row.entry));
          renderDetail(row);
        } catch (err) {
          console.error("Check-in field save failed", err);
          input.checked = !next;
        } finally {
          input.disabled = Boolean(item.disabled);
        }
      });
      label.appendChild(input);
      label.appendChild(span);
      listEl.appendChild(label);
    });

    if (!checkin.lunchRequired) {
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = "No pizza order requested for this ensemble.";
      listEl.appendChild(note);
    }

    container.appendChild(listEl);
  }

  // ── Form Sections ──

  function renderFormSections(row) {
    const entry = row.entry || {};
    const sections = [
      { key: "repertoire", title: "Program & Repertoire", render: renderRepertoireSection },
      { key: "instrumentation", title: "Instrumentation", render: renderInstrumentationSection },
      { key: "seating", title: "Seating & Setup", render: renderSeatingSection },
      { key: "percussion", title: "Percussion & Equipment", render: renderPercussionSection },
      { key: "lunch", title: "Lunch Order", render: renderLunchSection },
    ];

    sections.forEach(({ key, title, render }) => {
      const details = document.createElement("details");
      details.className = "panel accordion-card checkin-form-section";
      details.dataset.checkinSection = key;
      const summary = document.createElement("summary");
      summary.innerHTML = `<strong>${escapeHtml(title)}</strong>`;
      details.appendChild(summary);
      const body = document.createElement("div");
      body.className = "form-section stack";
      render(body, entry, row);
      details.appendChild(body);
      els.checkinDetailBody.appendChild(details);
    });
  }

  // ── Repertoire ──

  function renderRepertoireSection(container, entry, row) {
    const rep = entry.repertoire || {};
    const grade = entry.performanceGrade || "\u2014";

    const gradeRow = document.createElement("div");
    gradeRow.className = "note";
    gradeRow.innerHTML = `<strong>Performance Grade:</strong> ${escapeHtml(grade)}${entry.performanceGradeFlex ? " (Flex)" : ""}`;
    container.appendChild(gradeRow);

    const pieces = [
      { key: "march", label: "March" },
      { key: "selection1", label: "Selection #1" },
      { key: "selection2", label: "Selection #2" },
    ];

    pieces.forEach(({ key, label }) => {
      const piece = rep[key] || {};
      const row = document.createElement("div");
      row.className = "checkin-rep-piece";
      const pieceGrade = piece.grade ? ` (${piece.grade})` : "";
      row.innerHTML = `
        <div class="note"><strong>${escapeHtml(label)}${escapeHtml(pieceGrade)}:</strong> ${escapeHtml(piece.title || "\u2014")}</div>
        <div class="hint">${escapeHtml(piece.composer || "")}</div>
      `;
      container.appendChild(row);
    });

    if (rep.repertoireRuleMode === "masterwork") {
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = "Masterwork Exception active (Selection #2 optional).";
      container.appendChild(note);
    }

    addEditableSection(container, "repertoire", entry, row, renderRepertoireEdit);
  }

  function renderRepertoireEdit(container, entry, row) {
    const rep = entry.repertoire || {};

    // Performance grade
    const gradeLabel = document.createElement("label");
    gradeLabel.textContent = "Performance Grade";
    const gradeInput = document.createElement("input");
    gradeInput.type = "text";
    gradeInput.value = entry.performanceGrade || "";
    gradeInput.addEventListener("input", () => {
      state.checkin.entryDraft.performanceGrade = gradeInput.value.trim();
    });
    gradeLabel.appendChild(gradeInput);
    container.appendChild(gradeLabel);

    const pieces = [
      { key: "march", label: "March" },
      { key: "selection1", label: "Selection #1" },
      { key: "selection2", label: "Selection #2" },
    ];

    pieces.forEach(({ key, label }) => {
      const piece = rep[key] || {};
      const wrap = document.createElement("div");
      wrap.className = "stack checkin-edit-piece";

      if (key !== "march") {
        const gl = document.createElement("label");
        gl.textContent = `${label} Grade`;
        const gs = document.createElement("select");
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "Grade";
        gs.appendChild(emptyOpt);
        ["I", "II", "III", "IV", "V", "VI"].forEach((g) => {
          const opt = document.createElement("option");
          opt.value = g;
          opt.textContent = g;
          gs.appendChild(opt);
        });
        gs.value = piece.grade || "";
        gs.addEventListener("change", () => {
          ensureRepKey(key).grade = gs.value;
        });
        gl.appendChild(gs);
        wrap.appendChild(gl);
      }

      const tl = document.createElement("label");
      tl.textContent = `${label} Title`;
      const ti = document.createElement("input");
      ti.type = "text";
      ti.value = piece.title || "";
      ti.addEventListener("input", () => {
        ensureRepKey(key).title = ti.value.trim();
      });
      tl.appendChild(ti);
      wrap.appendChild(tl);

      const cl = document.createElement("label");
      cl.textContent = `${label} Composer`;
      const ci = document.createElement("input");
      ci.type = "text";
      ci.value = piece.composer || "";
      ci.addEventListener("input", () => {
        ensureRepKey(key).composer = ci.value.trim();
      });
      cl.appendChild(ci);
      wrap.appendChild(cl);

      container.appendChild(wrap);
    });
  }

  function ensureRepKey(key) {
    if (!state.checkin.entryDraft.repertoire) state.checkin.entryDraft.repertoire = {};
    if (!state.checkin.entryDraft.repertoire[key]) state.checkin.entryDraft.repertoire[key] = {};
    return state.checkin.entryDraft.repertoire[key];
  }

  // ── Instrumentation ──

  function renderInstrumentationSection(container, entry) {
    const inst = entry.instrumentation || {};
    const counts = inst.standardCounts || {};

    const grid = document.createElement("div");
    grid.className = "checkin-instr-grid";
    STANDARD_INSTRUMENTS.forEach((instr) => {
      const val = counts[instr.key] ?? 0;
      if (val > 0) {
        const item = document.createElement("div");
        item.className = "checkin-instr-item";
        item.innerHTML = `<span>${escapeHtml(instr.label)}</span><strong>${val}</strong>`;
        grid.appendChild(item);
      }
    });
    if (!grid.children.length) {
      grid.innerHTML = "<div class='hint'>No standard instruments entered.</div>";
    }
    container.appendChild(grid);

    if (inst.totalPercussion) {
      const tp = document.createElement("div");
      tp.className = "note";
      tp.innerHTML = `<strong>Total Percussion:</strong> ${inst.totalPercussion}`;
      container.appendChild(tp);
    }

    if (inst.nonStandard?.length) {
      const nsTitle = document.createElement("div");
      nsTitle.className = "note";
      nsTitle.innerHTML = "<strong>Non-Standard:</strong>";
      container.appendChild(nsTitle);
      inst.nonStandard.forEach((ns) => {
        const item = document.createElement("div");
        item.className = "hint";
        item.textContent = `${ns.instrumentName || "?"} \u00D7 ${ns.count || 0}`;
        container.appendChild(item);
      });
    }

    if (inst.otherInstrumentationNotes) {
      const notes = document.createElement("div");
      notes.className = "hint";
      notes.textContent = `Notes: ${inst.otherInstrumentationNotes}`;
      container.appendChild(notes);
    }

    addEditableSection(container, "instrumentation", entry, arguments[2], renderInstrumentationEdit);
  }

  function renderInstrumentationEdit(container, entry) {
    const inst = state.checkin.entryDraft.instrumentation || {};
    if (!inst.standardCounts) inst.standardCounts = {};

    const grid = document.createElement("div");
    grid.className = "grid-inputs";
    STANDARD_INSTRUMENTS.forEach((instr) => {
      const label = document.createElement("label");
      label.textContent = instr.label;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.value = inst.standardCounts[instr.key] ?? 0;
      input.addEventListener("change", () => {
        if (!state.checkin.entryDraft.instrumentation) state.checkin.entryDraft.instrumentation = {};
        if (!state.checkin.entryDraft.instrumentation.standardCounts) state.checkin.entryDraft.instrumentation.standardCounts = {};
        state.checkin.entryDraft.instrumentation.standardCounts[instr.key] = Number(input.value || 0);
      });
      label.appendChild(input);
      grid.appendChild(label);
    });
    container.appendChild(grid);

    const tpLabel = document.createElement("label");
    tpLabel.textContent = "Total Percussion";
    const tpInput = document.createElement("input");
    tpInput.type = "number";
    tpInput.min = "0";
    tpInput.value = inst.totalPercussion || 0;
    tpInput.addEventListener("change", () => {
      if (!state.checkin.entryDraft.instrumentation) state.checkin.entryDraft.instrumentation = {};
      state.checkin.entryDraft.instrumentation.totalPercussion = Number(tpInput.value || 0);
    });
    tpLabel.appendChild(tpInput);
    container.appendChild(tpLabel);

    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Notes";
    const notesInput = document.createElement("textarea");
    notesInput.rows = 2;
    notesInput.value = inst.otherInstrumentationNotes || "";
    notesInput.addEventListener("input", () => {
      if (!state.checkin.entryDraft.instrumentation) state.checkin.entryDraft.instrumentation = {};
      state.checkin.entryDraft.instrumentation.otherInstrumentationNotes = notesInput.value;
    });
    notesLabel.appendChild(notesInput);
    container.appendChild(notesLabel);
  }

  // ── Seating ──

  function renderSeatingSection(container, entry) {
    const seating = entry.seating || {};
    const rows = seating.rows || [];
    if (!rows.length) {
      container.innerHTML = "<div class='hint'>No seating data entered.</div>";
    } else {
      const table = document.createElement("table");
      table.className = "schedule-timeline-table";
      table.innerHTML = "<thead><tr><th>Row</th><th>Chairs</th><th>Stands</th></tr></thead>";
      const tbody = document.createElement("tbody");
      rows.forEach((r, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>Row ${i + 1}</td><td>${r.chairs || 0}</td><td>${r.stands || 0}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    }
    if (seating.notes) {
      const notes = document.createElement("div");
      notes.className = "hint";
      notes.textContent = `Notes: ${seating.notes}`;
      container.appendChild(notes);
    }
    addEditableSection(container, "seating", entry, arguments[2], renderSeatingEdit);
  }

  function renderSeatingEdit(container, entry) {
    const seating = state.checkin.entryDraft.seating || {};
    if (!seating.rows) seating.rows = [];
    // Ensure at least 5 rows
    while (seating.rows.length < 5) seating.rows.push({ chairs: 0, stands: 0 });

    seating.rows.forEach((r, i) => {
      const rowEl = document.createElement("div");
      rowEl.className = "entry-row";
      const cl = document.createElement("label");
      cl.textContent = `Chairs (Row ${i + 1})`;
      const ci = document.createElement("input");
      ci.type = "number";
      ci.min = "0";
      ci.value = r.chairs || 0;
      ci.addEventListener("change", () => {
        state.checkin.entryDraft.seating.rows[i].chairs = Number(ci.value || 0);
      });
      cl.appendChild(ci);
      const sl = document.createElement("label");
      sl.textContent = `Stands (Row ${i + 1})`;
      const si = document.createElement("input");
      si.type = "number";
      si.min = "0";
      si.value = r.stands || 0;
      si.addEventListener("change", () => {
        state.checkin.entryDraft.seating.rows[i].stands = Number(si.value || 0);
      });
      sl.appendChild(si);
      rowEl.appendChild(cl);
      rowEl.appendChild(sl);
      container.appendChild(rowEl);
    });

    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Seating notes";
    const notesInput = document.createElement("textarea");
    notesInput.rows = 2;
    notesInput.value = seating.notes || "";
    notesInput.addEventListener("input", () => {
      if (!state.checkin.entryDraft.seating) state.checkin.entryDraft.seating = {};
      state.checkin.entryDraft.seating.notes = notesInput.value;
    });
    notesLabel.appendChild(notesInput);
    container.appendChild(notesLabel);
  }

  // ── Percussion ──

  function renderPercussionSection(container, entry) {
    const perc = entry.percussionNeeds || {};
    const selected = perc.selected || [];
    if (!selected.length) {
      container.innerHTML = "<div class='hint'>No percussion equipment selected.</div>";
    } else {
      const list = document.createElement("ul");
      list.className = "checkin-perc-list";
      selected.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      container.appendChild(list);
    }
    if (perc.notes) {
      const notes = document.createElement("div");
      notes.className = "hint";
      notes.textContent = `Notes: ${perc.notes}`;
      container.appendChild(notes);
    }
    addEditableSection(container, "percussion", entry, arguments[2], renderPercussionEdit);
  }

  function renderPercussionEdit(container, entry) {
    const perc = state.checkin.entryDraft.percussionNeeds || {};
    const selected = new Set(perc.selected || []);

    PERCUSSION_OPTIONS.forEach((item) => {
      if (item && typeof item === "object" && item.type === "heading") {
        const heading = document.createElement("div");
        heading.className = "percussion-option-heading";
        heading.textContent = item.label || "";
        container.appendChild(heading);
        return;
      }
      if (item && typeof item === "object" && (item.type === "note" || item.type === "plain")) return;
      const optType = item && typeof item === "object" ? item.type : "";
      if (optType && optType !== "checkbox") return;
      const value = item && typeof item === "object" ? String(item.value || item.label || "").trim() : String(item || "").trim();
      const labelText = item && typeof item === "object" ? String(item.label || item.value || "").trim() : String(item || "").trim();
      if (!value || !labelText) return;

      const label = document.createElement("label");
      label.className = "row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(value);
      checkbox.addEventListener("change", () => {
        if (!state.checkin.entryDraft.percussionNeeds) state.checkin.entryDraft.percussionNeeds = {};
        const current = new Set(state.checkin.entryDraft.percussionNeeds.selected || []);
        if (checkbox.checked) current.add(value);
        else current.delete(value);
        state.checkin.entryDraft.percussionNeeds.selected = Array.from(current);
      });
      const span = document.createElement("span");
      span.textContent = labelText;
      label.appendChild(checkbox);
      label.appendChild(span);
      container.appendChild(label);
    });

    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Other percussion requests";
    const notesInput = document.createElement("textarea");
    notesInput.rows = 2;
    notesInput.value = perc.notes || "";
    notesInput.addEventListener("input", () => {
      if (!state.checkin.entryDraft.percussionNeeds) state.checkin.entryDraft.percussionNeeds = {};
      state.checkin.entryDraft.percussionNeeds.notes = notesInput.value;
    });
    notesLabel.appendChild(notesInput);
    container.appendChild(notesLabel);
  }

  // ── Lunch ──

  function renderLunchSection(container, entry) {
    const lunch = entry.lunchOrder || {};
    const pepperoni = lunch.pepperoniQty || 0;
    const cheese = lunch.cheeseQty || 0;
    const total = pepperoni + cheese;
    if (!total) {
      container.innerHTML = "<div class='hint'>No lunch order.</div>";
    } else {
      const info = document.createElement("div");
      info.className = "stack";
      info.innerHTML = `
        <div class="note"><strong>Pepperoni:</strong> ${pepperoni}</div>
        <div class="note"><strong>Cheese:</strong> ${cheese}</div>
        <div class="note"><strong>Total:</strong> ${total}</div>
        ${lunch.pickupTiming ? `<div class="note"><strong>Pickup:</strong> ${escapeHtml(lunch.pickupTiming)}</div>` : ""}
      `;
      container.appendChild(info);
    }
    if (lunch.notes) {
      const notes = document.createElement("div");
      notes.className = "hint";
      notes.textContent = `Notes: ${lunch.notes}`;
      container.appendChild(notes);
    }
    addEditableSection(container, "lunch", entry, arguments[2], renderLunchEdit);
  }

  function renderLunchEdit(container, entry) {
    const lunch = state.checkin.entryDraft.lunchOrder || {};

    const pLabel = document.createElement("label");
    pLabel.textContent = "Pepperoni";
    const pInput = document.createElement("input");
    pInput.type = "number";
    pInput.min = "0";
    pInput.value = lunch.pepperoniQty || 0;
    pInput.addEventListener("change", () => {
      if (!state.checkin.entryDraft.lunchOrder) state.checkin.entryDraft.lunchOrder = {};
      state.checkin.entryDraft.lunchOrder.pepperoniQty = Number(pInput.value || 0);
    });
    pLabel.appendChild(pInput);
    container.appendChild(pLabel);

    const cLabel = document.createElement("label");
    cLabel.textContent = "Cheese";
    const cInput = document.createElement("input");
    cInput.type = "number";
    cInput.min = "0";
    cInput.value = lunch.cheeseQty || 0;
    cInput.addEventListener("change", () => {
      if (!state.checkin.entryDraft.lunchOrder) state.checkin.entryDraft.lunchOrder = {};
      state.checkin.entryDraft.lunchOrder.cheeseQty = Number(cInput.value || 0);
    });
    cLabel.appendChild(cInput);
    container.appendChild(cLabel);

    const tLabel = document.createElement("label");
    tLabel.textContent = "Pickup Timing";
    const tInput = document.createElement("input");
    tInput.type = "text";
    tInput.value = lunch.pickupTiming || "";
    tInput.addEventListener("input", () => {
      if (!state.checkin.entryDraft.lunchOrder) state.checkin.entryDraft.lunchOrder = {};
      state.checkin.entryDraft.lunchOrder.pickupTiming = tInput.value.trim();
    });
    tLabel.appendChild(tInput);
    container.appendChild(tLabel);
  }

  // ── Editable section helper ──

  function addEditableSection(container, sectionKey, entry, row, editRenderer) {
    const actions = document.createElement("div");
    actions.className = "checkin-form-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ghost btn--sm";
    editBtn.textContent = "Edit";

    const editContainer = document.createElement("div");
    editContainer.className = "checkin-edit-form stack is-hidden";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save Changes";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ghost";
    cancelBtn.textContent = "Cancel";

    const status = document.createElement("div");
    status.className = "hint";

    editBtn.addEventListener("click", () => {
      // Reset draft for this section from current entry
      state.checkin.entryDraft = JSON.parse(JSON.stringify(row.entry || {}));
      editContainer.innerHTML = "";
      editRenderer(editContainer, entry, row);
      const btnRow = document.createElement("div");
      btnRow.className = "row";
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(status);
      editContainer.appendChild(btnRow);
      editContainer.classList.remove("is-hidden");
      editBtn.classList.add("is-hidden");
    });

    cancelBtn.addEventListener("click", () => {
      editContainer.classList.add("is-hidden");
      editContainer.innerHTML = "";
      editBtn.classList.remove("is-hidden");
      status.textContent = "";
    });

    saveBtn.addEventListener("click", async () => {
      if (state.checkin.saving) return;
      state.checkin.saving = true;
      saveBtn.disabled = true;
      status.textContent = "Saving\u2026";
      try {
        const payload = buildSavePayload(sectionKey);
        await updateEntryFields(state.event.active?.id, row.ensembleId, payload);
        // Update local row entry
        Object.assign(row.entry, payload);
        state.checkin.entryDraft = JSON.parse(JSON.stringify(row.entry));
        status.textContent = "Saved!";
        editContainer.classList.add("is-hidden");
        editContainer.innerHTML = "";
        editBtn.classList.remove("is-hidden");
        // Re-render detail to show updated values
        renderDetail(row);
      } catch (err) {
        console.error("Checkin save failed", err);
        status.textContent = "Save failed. Try again.";
      } finally {
        state.checkin.saving = false;
        saveBtn.disabled = false;
      }
    });

    actions.appendChild(editBtn);
    container.appendChild(actions);
    container.appendChild(editContainer);
  }

  function buildSavePayload(sectionKey) {
    const draft = state.checkin.entryDraft || {};
    switch (sectionKey) {
      case "repertoire":
        return {
          repertoire: draft.repertoire || {},
          performanceGrade: draft.performanceGrade || "",
          performanceGradeFlex: Boolean(draft.performanceGradeFlex),
        };
      case "instrumentation":
        return { instrumentation: draft.instrumentation || {} };
      case "seating":
        return { seating: draft.seating || {} };
      case "percussion":
        return { percussionNeeds: draft.percussionNeeds || {} };
      case "lunch":
        return { lunchOrder: draft.lunchOrder || {} };
      default:
        return {};
    }
  }

  // ── Public ──

  function render() {
    init();
    if (state.checkin.selectedEnsembleId) {
      const row = state.checkin.queueRows.find((r) => r.ensembleId === state.checkin.selectedEnsembleId);
      if (row) {
        showDetail();
        renderDetail(row);
        return;
      }
    }
    showQueue();
  }

  return { render, renderQueue, showQueue };
}
