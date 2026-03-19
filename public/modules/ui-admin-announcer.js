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
    prevBtn?.addEventListener("click", () => {
      state.admin.announcerCurrentIndex = Math.max(0, resolveCurrentIndex(rows) - 1);
      renderAnnouncerContent(rows, eventName);
    });
    nextBtn?.addEventListener("click", () => {
      state.admin.announcerCurrentIndex = Math.min(rows.length - 1, resolveCurrentIndex(rows) + 1);
      renderAnnouncerContent(rows, eventName);
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
            <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/flow">Open Schedule &amp; Flow</button>
            <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/registrations">Open Registrations</button>
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
              <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/settings">Open Settings</button>
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
            <button type="button" class="ghost btn--sm" data-announcer-nav="#admin/flow">Open Schedule &amp; Flow</button>
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
