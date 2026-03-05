export function createAdminRenderers({
  els,
  state,
  db,
  COLLECTIONS,
  collection,
  getDocs,
  query,
  where,
  fetchRegisteredEnsembles,
  fetchScheduleEntries,
  getSchoolNameById,
  normalizeEnsembleDisplayName,
  toLocalDatetimeValue,
  deriveAutoScheduleDayBreaks,
  mergeScheduleDayBreaks,
  formatPerformanceAt,
  getPacketData,
  releasePacket,
  unreleasePacket,
  lockOpenPacket,
  unlockOpenPacket,
  releaseOpenPacket,
  unreleaseOpenPacket,
  renderSubmissionCard,
  loadAdminPacketView,
  alertUser,
  createScheduleEntry,
  deleteScheduleEntry,
  updateScheduleEntryTime,
  computeScheduleTimeline,
  formatAdminDayOfReadOnly,
  openDirectorDayOfFromAdmin,
  closeAdminSchoolDetail,
  applyAdminView,
  schedulePreEventGuidedFlowRender,
} = {}) {
  let adminSchoolDetailRenderInFlight = false;
  let adminSchoolDetailRenderQueued = false;
  let adminPacketsRenderInFlight = false;
  let adminPacketsRenderQueued = false;
  let registeredRenderInFlight = false;
  let registeredRenderQueued = false;

  function formatPacketTimestamp(value) {
    const ms = value?.toMillis ? value.toMillis() : null;
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString();
    } catch (_error) {
      return "";
    }
  }

  function normalizeOpenPacketStatus(value) {
    const raw = String(value || "").trim();
    return raw || "draft";
  }

  function toOpenSubmission(packet) {
    const status = normalizeOpenPacketStatus(packet.status);
    return {
      status,
      locked: Boolean(packet.locked),
      judgeName: packet.createdByJudgeName || "",
      judgeEmail: packet.createdByJudgeEmail || "",
      judgeTitle: "",
      judgeAffiliation: "",
      audioUrl: packet.latestAudioUrl || "",
      transcript: String(packet.transcriptFull || packet.transcript || "").trim(),
      captions: packet.captions && typeof packet.captions === "object" ? packet.captions : {},
      formType: packet.formType || "stage",
      captionScoreTotal: Number.isFinite(Number(packet.captionScoreTotal))
        ? Number(packet.captionScoreTotal)
        : null,
      computedFinalRatingLabel: packet.computedFinalRatingLabel || "N/A",
    };
  }

  async function renderAdminSchoolDetail() {
    if (adminSchoolDetailRenderInFlight) {
      adminSchoolDetailRenderQueued = true;
      return;
    }
    adminSchoolDetailRenderInFlight = true;
    try {
      if (!els.adminSchoolDetailList || !els.adminSchoolDetailTitle || !els.adminSchoolDetailMeta || !els.adminSchoolDetailHint) return;
      const eventId = state.event.active?.id || "";
      const schoolId = state.admin.selectedSchoolId || "";
      if (!eventId || !schoolId) {
        closeAdminSchoolDetail();
        return;
      }

      const schoolName = state.admin.selectedSchoolName || getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
      els.adminSchoolDetailTitle.textContent = `${schoolName} - Scheduling & Day-of`;
      els.adminSchoolDetailMeta.textContent = `Event: ${state.event.active?.name || "Active Event"}`;
      els.adminSchoolDetailHint.textContent = "Read-only day-of snapshot appears below each ensemble. Use \"Open in Director\" to edit.";
      els.adminSchoolDetailList.innerHTML = "";

      const [registered, scheduleEntries, entriesSnap] = await Promise.all([
        fetchRegisteredEnsembles(eventId),
        fetchScheduleEntries(eventId),
        getDocs(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries)),
      ]);
      const stale =
        state.admin.currentView !== "preEvent" ||
        (state.event.active?.id || "") !== eventId ||
        state.admin.selectedSchoolId !== schoolId;
      if (stale) return;
      const schoolEnsembles = registered.filter((entry) => (entry.schoolId || "") === schoolId);
      if (!schoolEnsembles.length) {
        els.adminSchoolDetailList.innerHTML = "<li class='hint'>No registered ensembles for this school.</li>";
        return;
      }
      const scheduleByEnsemble = new Map((scheduleEntries || []).map((row) => [row.ensembleId || row.id, row]));
      const entryDataByEnsemble = new Map();
      entriesSnap.forEach((snap) => {
        if (!snap?.exists()) return;
        entryDataByEnsemble.set(snap.id, snap.data());
      });
      const registeredByEnsemble = new Map(
        (registered || []).map((row) => [row.ensembleId || row.id, row])
      );

      async function recalculateFromScheduleEntry({
        anchorScheduleEntryId,
        anchorPerformanceAt,
      } = {}) {
        if (!anchorScheduleEntryId || !(anchorPerformanceAt instanceof Date)) return;
        const allScheduleEntries = await fetchScheduleEntries(eventId);
        const sorted = [...(allScheduleEntries || [])].sort((a, b) => {
          const aTime = a.performanceAt?.toDate
            ? a.performanceAt.toDate().getTime()
            : new Date(a.performanceAt || 0).getTime();
          const bTime = b.performanceAt?.toDate
            ? b.performanceAt.toDate().getTime()
            : new Date(b.performanceAt || 0).getTime();
          return aTime - bTime;
        });
        const anchorIndex = sorted.findIndex((row) => row.id === anchorScheduleEntryId);
        if (anchorIndex < 0) return;
        const slice = sorted.slice(anchorIndex);
        if (!slice.length) return;
        const breakSet = new Set(
          Array.isArray(state.event.active?.scheduleBreaks) ? state.event.active.scheduleBreaks : []
        );
        const autoDayBreaks = deriveAutoScheduleDayBreaks(slice);
        const dayBreaks = mergeScheduleDayBreaks(
          state.event.active?.scheduleDayBreaks || {},
          autoDayBreaks
        );
        const getGrade = (row) => {
          const registeredRow = registeredByEnsemble.get(row.ensembleId || row.id) || {};
          return registeredRow.declaredGradeLevel || registeredRow.performanceGrade || null;
        };
        const timeline = computeScheduleTimeline(
          anchorPerformanceAt,
          slice,
          breakSet,
          getGrade,
          dayBreaks
        );
        for (const row of timeline) {
          await updateScheduleEntryTime({
            eventId,
            entryId: row.entryId,
            nextDate: row.performStart,
          });
        }
      }

      for (const entry of schoolEnsembles) {
        const ensembleId = entry.ensembleId || entry.id;
        if (!ensembleId) continue;
        const ensembleName = normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: entry.ensembleName || "",
          ensembleId,
        });
        const scheduleEntry = scheduleByEnsemble.get(ensembleId);
        const perfValue = scheduleEntry?.performanceAt
          ? toLocalDatetimeValue(
              scheduleEntry.performanceAt.toDate
                ? scheduleEntry.performanceAt.toDate()
                : new Date(scheduleEntry.performanceAt)
            )
          : "";
        const entryData = entryDataByEnsemble.get(ensembleId) || null;

        const li = document.createElement("li");
        li.className = "panel";
        const header = document.createElement("div");
        header.className = "row row--between";
        const title = document.createElement("strong");
        title.textContent = ensembleName;
        const meta = document.createElement("span");
        meta.className = "badge";
        meta.textContent = `Grade ${entry.declaredGradeLevel || "—"}`;
        header.appendChild(title);
        header.appendChild(meta);
        li.appendChild(header);

        const scheduleRow = document.createElement("div");
        scheduleRow.className = "row";
        const scheduleInput = document.createElement("input");
        scheduleInput.type = "datetime-local";
        scheduleInput.value = perfValue;
        const scheduleSave = document.createElement("button");
        scheduleSave.type = "button";
        scheduleSave.className = "ghost";
        scheduleSave.textContent = "Save Performance Time";
        const scheduleRecalc = document.createElement("button");
        scheduleRecalc.type = "button";
        scheduleRecalc.className = "ghost";
        scheduleRecalc.textContent = "Recalculate From Here";
        scheduleRecalc.disabled = !scheduleEntry;
        const scheduleDelete = document.createElement("button");
        scheduleDelete.type = "button";
        scheduleDelete.className = "ghost danger";
        scheduleDelete.textContent = "Remove from Schedule";
        scheduleDelete.disabled = !scheduleEntry;
        scheduleSave.addEventListener("click", async () => {
          const raw = scheduleInput.value;
          if (!raw) {
            alertUser("Enter a performance date and time.");
            return;
          }
          const nextDate = new Date(raw);
          if (Number.isNaN(nextDate.getTime())) {
            alertUser("Invalid date/time.");
            return;
          }
          scheduleSave.disabled = true;
          try {
            if (scheduleEntry) {
              await updateScheduleEntryTime({ eventId, entryId: scheduleEntry.id, nextDate });
            } else {
              await createScheduleEntry({
                eventId,
                performanceAtDate: nextDate,
                schoolId,
                ensembleId,
                ensembleName,
              });
            }
            await renderAdminSchoolDetail();
            await renderRegisteredEnsemblesList();
          } finally {
            scheduleSave.disabled = false;
          }
        });
        scheduleRecalc.addEventListener("click", async () => {
          if (!scheduleEntry) {
            alertUser("Save a performance time first, then recalculate.");
            return;
          }
          const raw = scheduleInput.value;
          if (!raw) {
            alertUser("Enter a performance date and time.");
            return;
          }
          const nextDate = new Date(raw);
          if (Number.isNaN(nextDate.getTime())) {
            alertUser("Invalid date/time.");
            return;
          }
          scheduleSave.disabled = true;
          scheduleRecalc.disabled = true;
          try {
            await recalculateFromScheduleEntry({
              anchorScheduleEntryId: scheduleEntry.id,
              anchorPerformanceAt: nextDate,
            });
            await renderAdminSchoolDetail();
            await renderRegisteredEnsemblesList();
          } finally {
            scheduleSave.disabled = false;
            scheduleRecalc.disabled = false;
          }
        });
        scheduleDelete.addEventListener("click", async () => {
          if (!scheduleEntry) return;
          const shouldDelete = window.confirm(
            `Remove ${ensembleName} from this event schedule?`
          );
          if (!shouldDelete) return;
          scheduleSave.disabled = true;
          scheduleRecalc.disabled = true;
          scheduleDelete.disabled = true;
          try {
            await deleteScheduleEntry({ eventId, entryId: scheduleEntry.id });
            await renderAdminSchoolDetail();
            await renderRegisteredEnsemblesList();
          } finally {
            scheduleSave.disabled = false;
            scheduleRecalc.disabled = false;
            scheduleDelete.disabled = false;
          }
        });
        scheduleRow.appendChild(scheduleInput);
        scheduleRow.appendChild(scheduleSave);
        scheduleRow.appendChild(scheduleRecalc);
        scheduleRow.appendChild(scheduleDelete);
        li.appendChild(scheduleRow);

        const readOnly = document.createElement("div");
        readOnly.className = "note";
        readOnly.textContent = formatAdminDayOfReadOnly(entryData);
        li.appendChild(readOnly);

        const actions = document.createElement("div");
        actions.className = "row";
        const openDirectorBtn = document.createElement("button");
        openDirectorBtn.type = "button";
        openDirectorBtn.className = "ghost";
        openDirectorBtn.textContent = "Open in Director Day-of";
        openDirectorBtn.addEventListener("click", async () => {
          openDirectorBtn.disabled = true;
          try {
            await openDirectorDayOfFromAdmin({ eventId, schoolId, ensembleId });
          } finally {
            openDirectorBtn.disabled = false;
          }
        });
        actions.appendChild(openDirectorBtn);
        li.appendChild(actions);

        els.adminSchoolDetailList.appendChild(li);
      }
    } finally {
      adminSchoolDetailRenderInFlight = false;
      if (adminSchoolDetailRenderQueued) {
        adminSchoolDetailRenderQueued = false;
        queueMicrotask(() => {
          renderAdminSchoolDetail();
        });
      }
    }
  }

  async function renderAdminPacketsBySchedule() {
    if (adminPacketsRenderInFlight) {
      adminPacketsRenderQueued = true;
      return;
    }
    adminPacketsRenderInFlight = true;
    try {
      if (!els.adminPacketsList || !els.adminPacketsHint || !els.adminPacketsSchoolSelect) return;
      const eventId = state.event.active?.id || "";
      if (!eventId) {
        els.adminPacketsHint.textContent = "Set an active event to begin.";
        els.adminPacketsList.innerHTML = "";
        els.adminPacketsSchoolSelect.innerHTML = "";
        return;
      }
      els.adminPacketsHint.textContent = "Loading scheduled ensembles...";
      els.adminPacketsList.innerHTML = "";

      const scheduleEntries = await fetchScheduleEntries(eventId);
      if (state.admin.currentView !== "packets" || (state.event.active?.id || "") !== eventId) return;

      const ordered = [...(scheduleEntries || [])].sort((a, b) => {
        const aMs = a.performanceAt?.toDate ? a.performanceAt.toDate().getTime() : 0;
        const bMs = b.performanceAt?.toDate ? b.performanceAt.toDate().getTime() : 0;
        return aMs - bMs;
      });
      if (!ordered.length) {
        els.adminPacketsHint.textContent = "No scheduled ensembles for the active event.";
        els.adminPacketsSchoolSelect.innerHTML = "";
        return;
      }

      const schools = [];
      const seenSchoolIds = new Set();
      ordered.forEach((entry) => {
        const schoolId = String(entry.schoolId || "").trim();
        if (!schoolId || seenSchoolIds.has(schoolId)) return;
        seenSchoolIds.add(schoolId);
        const schoolName =
          entry.schoolName || getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
        schools.push({ schoolId, schoolName });
      });
      schools.sort((a, b) => String(a.schoolName || "").localeCompare(String(b.schoolName || "")));

      const previous = state.admin.packetsSchoolId || "";
      const validSelection =
        previous && schools.some((item) => item.schoolId === previous) ? previous : "";
      state.admin.packetsSchoolId = validSelection;

      const previousDomValue = els.adminPacketsSchoolSelect.value || "";
      if (previousDomValue !== validSelection || els.adminPacketsSchoolSelect.options.length !== schools.length + 1) {
        els.adminPacketsSchoolSelect.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select a school";
        els.adminPacketsSchoolSelect.appendChild(placeholder);
        schools.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.schoolId;
          option.textContent = item.schoolName;
          els.adminPacketsSchoolSelect.appendChild(option);
        });
        els.adminPacketsSchoolSelect.value = validSelection;
      }

      if (!state.admin.packetsSchoolId) {
        els.adminPacketsHint.textContent = "Select a school to load packet review.";
        return;
      }
      const filtered = ordered.filter((entry) => (entry.schoolId || "") === state.admin.packetsSchoolId);
      if (!filtered.length) {
        els.adminPacketsHint.textContent = "No scheduled ensembles found for this school.";
        return;
      }
      els.adminPacketsHint.textContent = "Loading packet status for selected school...";

      for (const entry of filtered) {
        const ensembleId = entry.ensembleId || "";
        if (!ensembleId) continue;
        const schoolName = entry.schoolName || getSchoolNameById(state.admin.schoolsList, entry.schoolId) || "Unknown school";
        const ensembleName = normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: entry.ensembleName || "",
          ensembleId,
        });
        const performLabel = formatPerformanceAt(entry.performanceAt);
        const packetData = await getPacketData({ eventId, entry });
        if (state.admin.currentView !== "packets" || (state.event.active?.id || "") !== eventId) return;
        const summary = packetData?.summary || null;
        const li = document.createElement("li");
        li.className = "panel";

        const top = document.createElement("div");
        top.className = "row row--between row--center";
        const title = document.createElement("strong");
        title.textContent = `${schoolName} - ${ensembleName}`;
        top.appendChild(title);

        const right = document.createElement("div");
        right.className = "row";
        const scheduleBadge = document.createElement("span");
        scheduleBadge.className = "badge";
        scheduleBadge.textContent = performLabel || "Unscheduled";
        const statusBadge = document.createElement("span");
        statusBadge.className = "badge";
        if (summary?.requiredReleased) {
          statusBadge.textContent = "Released";
        } else if (summary?.requiredComplete) {
          statusBadge.textContent = "Ready to Release";
        } else {
          statusBadge.textContent = "Incomplete";
        }
        right.appendChild(scheduleBadge);
        right.appendChild(statusBadge);
        top.appendChild(right);
        li.appendChild(top);

        const meta = document.createElement("div");
        meta.className = "note";
        meta.textContent = `Director: ${packetData?.directorName || "Unknown"} - Grade: ${packetData?.grade || "Unknown"} - Overall: ${summary?.overall?.label || "N/A"}`;
        li.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "row";
        const releaseBtn = document.createElement("button");
        releaseBtn.type = "button";
        const shouldRelease = !summary?.requiredReleased;
        releaseBtn.textContent = shouldRelease ? "Release Packet" : "Unrelease Packet";
        releaseBtn.disabled = shouldRelease ? !summary?.requiredComplete : false;

        releaseBtn.addEventListener("click", async () => {
          releaseBtn.disabled = true;
          try {
            if (shouldRelease) {
              await releasePacket({ eventId, ensembleId });
            } else {
              await unreleasePacket({ eventId, ensembleId });
            }
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("Update packet release failed", error);
            alertUser(error?.message || "Unable to update packet release state.");
          }
        });
        actions.appendChild(releaseBtn);

        const panel = document.createElement("div");
        panel.className = "packet-panel is-hidden";
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "ghost";
        viewBtn.textContent = "View Packet";
        viewBtn.addEventListener("click", async () => {
          const isHidden = panel.classList.contains("is-hidden");
          if (isHidden) {
            panel.classList.remove("is-hidden");
            viewBtn.textContent = "Hide Packet";
            await loadAdminPacketView(entry, panel, eventId);
          } else {
            panel.classList.add("is-hidden");
            viewBtn.textContent = "View Packet";
          }
        });
        actions.appendChild(viewBtn);
        li.appendChild(actions);
        li.appendChild(panel);
        els.adminPacketsList.appendChild(li);
      }

      const selectedSchoolId = state.admin.packetsSchoolId || "";
      const openPacketsSnap = await getDocs(
        query(
          collection(db, COLLECTIONS.packets),
          where("schoolId", "==", selectedSchoolId)
        )
      );
      if (state.admin.currentView !== "packets" || (state.event.active?.id || "") !== eventId) return;
      const openPackets = openPacketsSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((packet) => {
          const assignmentEventId = String(packet.assignmentEventId || "").trim();
          return !assignmentEventId || assignmentEventId === eventId;
        })
        .sort((a, b) => {
          const aMs = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
          const bMs = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
          return bMs - aMs;
        });

      const openSection = document.createElement("li");
      openSection.className = "panel";
      const openTitle = document.createElement("h4");
      openTitle.textContent = "Open Judge Sheets";
      openSection.appendChild(openTitle);
      const openHint = document.createElement("p");
      openHint.className = "hint";
      openHint.textContent = "Individual Open Judge tapes for this school.";
      openSection.appendChild(openHint);

      if (!openPackets.length) {
        const empty = document.createElement("div");
        empty.className = "note";
        empty.textContent = "No Open Judge sheets found for this school.";
        openSection.appendChild(empty);
      } else {
        const openList = document.createElement("div");
        openList.className = "stack";
        openPackets.forEach((packet) => {
          const row = document.createElement("div");
          row.className = "panel";
          const top = document.createElement("div");
          top.className = "row row--between row--center";
          const title = document.createElement("strong");
          title.textContent = `${packet.schoolName || "School"} - ${packet.ensembleName || "Ensemble"}`;
          top.appendChild(title);
          const badges = document.createElement("div");
          badges.className = "row";
          const statusBadge = document.createElement("span");
          statusBadge.className = "badge";
          statusBadge.textContent = `Open: ${packet.status || "draft"}`;
          badges.appendChild(statusBadge);
          const formBadge = document.createElement("span");
          formBadge.className = "badge";
          formBadge.textContent = (packet.formType || "stage").toUpperCase();
          badges.appendChild(formBadge);
          top.appendChild(badges);
          row.appendChild(top);

          const meta = document.createElement("div");
          meta.className = "note";
          const judgeLabel =
            packet.createdByJudgeName ||
            packet.createdByJudgeEmail ||
            packet.createdByJudgeUid ||
            "Unknown judge";
          const ratingLabel = packet.computedFinalRatingLabel || "N/A";
          const updatedLabel = formatPacketTimestamp(packet.updatedAt) || "Recently updated";
          meta.textContent = `Judge: ${judgeLabel} - Rating: ${ratingLabel} - Updated: ${updatedLabel}`;
          row.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "row";
          const viewBtn = document.createElement("button");
          viewBtn.type = "button";
          viewBtn.className = "ghost";
          viewBtn.textContent = "View Open Sheet";
          const detail = document.createElement("div");
          detail.className = "packet-panel is-hidden";
          viewBtn.addEventListener("click", async () => {
            const isHidden = detail.classList.contains("is-hidden");
            detail.classList.toggle("is-hidden", !isHidden);
            viewBtn.textContent = isHidden ? "Hide Open Sheet" : "View Open Sheet";
            if (isHidden) {
              detail.innerHTML = "";
              const topMeta = document.createElement("div");
              topMeta.className = "note";
              topMeta.textContent = `Packet ID: ${packet.id} - Updated: ${formatPacketTimestamp(packet.updatedAt) || "Recently updated"}`;
              detail.appendChild(topMeta);
              const summaryCard = renderSubmissionCard(
                toOpenSubmission(packet),
                packet.judgePosition || (packet.formType === "sight" ? "sight" : "stage1"),
                { showTranscript: true }
              );
              detail.appendChild(summaryCard);

              const controls = document.createElement("div");
              controls.className = "actions";
              const isLocked = Boolean(packet.locked);
              const lockBtn = document.createElement("button");
              lockBtn.type = "button";
              lockBtn.className = "ghost";
              lockBtn.textContent = isLocked ? "Unlock Open Sheet" : "Lock Open Sheet";
              lockBtn.addEventListener("click", async () => {
                lockBtn.disabled = true;
                try {
                  if (isLocked) {
                    await unlockOpenPacket({ packetId: packet.id });
                  } else {
                    await lockOpenPacket({ packetId: packet.id });
                  }
                  await renderAdminPacketsBySchedule();
                } catch (error) {
                  console.error("Open packet lock/unlock failed", error);
                  alertUser(error?.message || "Unable to update open sheet lock state.");
                } finally {
                  lockBtn.disabled = false;
                }
              });
              controls.appendChild(lockBtn);

              const status = normalizeOpenPacketStatus(packet.status);
              const releaseBtn = document.createElement("button");
              releaseBtn.type = "button";
              const shouldUnrelease = status === "released";
              releaseBtn.textContent = shouldUnrelease ? "Unrelease Open Sheet" : "Release Open Sheet";
              releaseBtn.addEventListener("click", async () => {
                releaseBtn.disabled = true;
                try {
                  if (shouldUnrelease) {
                    await unreleaseOpenPacket({ packetId: packet.id });
                  } else {
                    await releaseOpenPacket({ packetId: packet.id });
                  }
                  await renderAdminPacketsBySchedule();
                } catch (error) {
                  console.error("Open packet release/unrelease failed", error);
                  alertUser(error?.message || "Unable to update open sheet release state.");
                } finally {
                  releaseBtn.disabled = false;
                }
              });
              controls.appendChild(releaseBtn);
              detail.appendChild(controls);

              const packetIdRow = document.createElement("div");
              packetIdRow.className = "note";
              packetIdRow.textContent = `Tape Duration: ${
                Number.isFinite(Number(packet.tapeDurationSec)) ?
                  `${Math.round(Number(packet.tapeDurationSec))}s` :
                  "—"
              }`;
              detail.appendChild(packetIdRow);
            }
          });
          actions.appendChild(viewBtn);
          row.appendChild(actions);
          row.appendChild(detail);
          openList.appendChild(row);
        });
        openSection.appendChild(openList);
      }
      els.adminPacketsList.appendChild(openSection);
      els.adminPacketsHint.textContent = "";
    } catch (error) {
      console.error("renderAdminPacketsBySchedule failed", error);
      if (els.adminPacketsHint) {
        els.adminPacketsHint.textContent = "Unable to load packet review right now.";
      }
    } finally {
      adminPacketsRenderInFlight = false;
      if (adminPacketsRenderQueued) {
        adminPacketsRenderQueued = false;
        queueMicrotask(() => {
          renderAdminPacketsBySchedule();
        });
      }
    }
  }

  async function renderRegisteredEnsemblesList() {
    if (registeredRenderInFlight) {
      registeredRenderQueued = true;
      return;
    }
    registeredRenderInFlight = true;
    try {
      if (!els.adminRegisteredEnsemblesList) return;
      els.adminRegisteredEnsemblesList.innerHTML = "";
      const eventId = state.event.active?.id;
      if (!eventId) return;

      const [registered, scheduleEntries, entriesSnap] = await Promise.all([
        fetchRegisteredEnsembles(eventId),
        fetchScheduleEntries(eventId),
        getDocs(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries)),
      ]);

      if (!registered.length) {
        els.adminRegisteredEnsemblesList.innerHTML =
          "<li class='hint'>No ensembles have registered yet.</li>";
        schedulePreEventGuidedFlowRender();
        return;
      }

      const scheduleByEnsemble = new Map((scheduleEntries || []).map((row) => [row.ensembleId || row.id, row]));
      const entryDataByEnsemble = new Map();
      entriesSnap.forEach((snap) => {
        if (!snap?.exists()) return;
        entryDataByEnsemble.set(snap.id, snap.data());
      });

      const bySchool = new Map();
      registered.forEach((entry) => {
        const schoolId = entry.schoolId || "";
        if (!schoolId) return;
        if (!bySchool.has(schoolId)) bySchool.set(schoolId, []);
        bySchool.get(schoolId).push(entry);
      });

      const schoolIds = [...bySchool.keys()].sort((a, b) => {
        const aName = getSchoolNameById(state.admin.schoolsList, a) || a;
        const bName = getSchoolNameById(state.admin.schoolsList, b) || b;
        return aName.localeCompare(bName);
      });

      schoolIds.forEach((schoolId) => {
        const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
        const schoolEnsembles = bySchool.get(schoolId) || [];
        const scheduledCount = schoolEnsembles.filter((entry) =>
          scheduleByEnsemble.has(entry.ensembleId || entry.id)
        ).length;
        const readyCount = schoolEnsembles.filter((entry) => {
          const key = entry.ensembleId || entry.id;
          if (!scheduleByEnsemble.has(key)) return false;
          return entryDataByEnsemble.get(key)?.status === "ready";
        }).length;
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "admin-school-row-btn";
        const row = document.createElement("div");
        row.className = "row";
        const title = document.createElement("strong");
        title.textContent = schoolName;
        const meta = document.createElement("span");
        meta.className = "admin-school-summary-meta";
        const ensBadge = document.createElement("span");
        ensBadge.className = "badge";
        ensBadge.textContent = `${schoolEnsembles.length} ensemble${schoolEnsembles.length === 1 ? "" : "s"}`;
        const schedBadge = document.createElement("span");
        schedBadge.className = "badge";
        schedBadge.textContent = `Scheduled ${scheduledCount}/${schoolEnsembles.length}`;
        const readyBadge = document.createElement("span");
        readyBadge.className = "badge";
        readyBadge.textContent = `Ready ${readyCount}/${scheduledCount || 0}`;
        meta.appendChild(ensBadge);
        meta.appendChild(schedBadge);
        meta.appendChild(readyBadge);
        row.appendChild(title);
        row.appendChild(meta);
        button.appendChild(row);
        button.addEventListener("click", () => {
          state.admin.selectedSchoolId = schoolId;
          state.admin.selectedSchoolName = schoolName;
          applyAdminView("preEvent");
        });
        li.appendChild(button);
        els.adminRegisteredEnsemblesList.appendChild(li);
      });

      schedulePreEventGuidedFlowRender();
    } finally {
      registeredRenderInFlight = false;
      if (registeredRenderQueued) {
        registeredRenderQueued = false;
        queueMicrotask(() => {
          renderRegisteredEnsemblesList();
        });
      }
    }
  }

  return {
    renderAdminSchoolDetail,
    renderAdminPacketsBySchedule,
    renderRegisteredEnsemblesList,
  };
}
