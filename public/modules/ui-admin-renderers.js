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
  resolveCurrentRegisteredEnsembles,
  fetchScheduleEntries,
  getSchoolNameById,
  normalizeEnsembleDisplayName,
  toDateOrNull,
  toLocalDatetimeValue,
  deriveAutoScheduleDayBreaks,
  mergeScheduleDayBreaks,
  formatPerformanceAt,
  getPacketData,
  fetchDirectorPacketAssets,
  generateOpenPacketPrintAsset,
  regenerateDirectorPacketExport,
  releasePacket,
  unreleasePacket,
  deleteScheduledPacket,
  lockOpenPacket,
  unlockOpenPacket,
  releaseOpenPacket,
  unreleaseOpenPacket,
  deleteOpenPacket,
  attachManualAudioToScheduledPacket,
  attachManualAudioToOpenPacket,
  createAudioOnlyResultFromFile,
  releaseAudioOnlyResult,
  unreleaseAudioOnlyResult,
  repairManualAudioOverrides,
  repairOpenSubmissionAudioMetadata,
  deleteAllUnreleasedPackets,
  cleanupTestArtifacts,
  renderSubmissionCard,
  loadAdminPacketView,
  confirmUser,
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
  scheduleAdminPreflightRefresh,
  refreshPreEventScheduleTimelineStarts,
} = {}) {
  let adminSchoolDetailRenderInFlight = false;
  let adminSchoolDetailRenderQueued = false;
  let adminPacketsRenderInFlight = false;
  let adminPacketsRenderQueued = false;
  let registeredRenderInFlight = false;
  let registeredRenderQueued = false;

  function formatBlockerError(error, fallbackMessage) {
    const blockers = Array.isArray(error?.details?.blockers) ? error.details.blockers : [];
    if (!blockers.length) return error?.message || fallbackMessage;
    const lines = blockers.map((blocker) => `- ${blocker.message || blocker.code || "Blocked"}`);
    return `${fallbackMessage}\n${lines.join("\n")}`;
  }

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

  function formatDuration(totalSec) {
    const seconds = Number(totalSec || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const whole = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(whole / 3600);
    const mins = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function getAdminPacketAssetCacheKey({ eventId, ensembleId } = {}) {
    return `${String(eventId || "").trim()}_${String(ensembleId || "").trim()}`;
  }

  function renderAdminPacketAssetsSection({ eventId, ensembleId }, wrapper) {
    const resolvedEventId = String(eventId || "").trim();
    const resolvedEnsembleId = String(ensembleId || "").trim();
    if (!resolvedEventId || !resolvedEnsembleId || !wrapper) return;
    if (!(state.admin.packetAssetsCache instanceof Map)) {
      state.admin.packetAssetsCache = new Map();
    }
    const cacheKey = getAdminPacketAssetCacheKey({
      eventId: resolvedEventId,
      ensembleId: resolvedEnsembleId,
    });

    const section = document.createElement("div");
    section.className = "panel stack";
    const title = document.createElement("strong");
    title.textContent = "Printable Judge Sheets";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent =
      "Generate or load the exact-match stage form PDFs for pre-printing and packet review.";
    section.appendChild(title);
    section.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "row";
    const generateBtn = document.createElement("button");
    generateBtn.type = "button";
    generateBtn.className = "ghost";
    generateBtn.textContent = "Prepare Print Files";
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "ghost";
    loadBtn.textContent = "Load Print Files";
    actions.appendChild(generateBtn);
    actions.appendChild(loadBtn);
    section.appendChild(actions);

    const output = document.createElement("div");
    output.className = "stack";
    section.appendChild(output);

    const renderAssets = (assets) => {
      output.innerHTML = "";
      if (!assets || assets.status !== "ready") {
        const pending = document.createElement("div");
        pending.className = "note";
        pending.textContent = assets?.status === "failed" ?
          `Export failed: ${assets?.error || "Unknown error"}` :
          "Print files are not ready yet. Use Prepare Print Files to generate them.";
        output.appendChild(pending);
        return;
      }

      if (assets.combined?.url) {
        const combinedRow = document.createElement("div");
        combinedRow.className = "row";
        const openCombined = document.createElement("a");
        openCombined.className = "ghost";
        openCombined.href = assets.combined.url;
        openCombined.target = "_blank";
        openCombined.rel = "noopener";
        openCombined.textContent = "Open Full Packet PDF";
        const printCombined = document.createElement("a");
        printCombined.className = "ghost";
        printCombined.href = assets.combined.url;
        printCombined.target = "_blank";
        printCombined.rel = "noopener";
        printCombined.textContent = "Print Full Packet PDF";
        combinedRow.appendChild(openCombined);
        combinedRow.appendChild(printCombined);
        output.appendChild(combinedRow);
      }

      const judgeAssets = assets.judges && typeof assets.judges === "object" ? assets.judges : {};
      Object.values(judgeAssets).forEach((item) => {
        const row = document.createElement("div");
        row.className = "packet-card";
        const label = document.createElement("div");
        label.className = "badge";
        label.textContent = item.judgeLabel || item.judgePosition || "Judge";
        row.appendChild(label);

        const fileActions = document.createElement("div");
        fileActions.className = "row";
        if (item.pdfUrl) {
          const openPdf = document.createElement("a");
          openPdf.className = "ghost";
          openPdf.href = item.pdfUrl;
          openPdf.target = "_blank";
          openPdf.rel = "noopener";
          openPdf.textContent = "Open Form PDF";
          const printPdf = document.createElement("a");
          printPdf.className = "ghost";
          printPdf.href = item.pdfUrl;
          printPdf.target = "_blank";
          printPdf.rel = "noopener";
          printPdf.textContent = "Print Form PDF";
          fileActions.appendChild(openPdf);
          fileActions.appendChild(printPdf);
        }
        if (item.audioUrl) {
          const audioLink = document.createElement("a");
          audioLink.className = "ghost";
          audioLink.href = item.audioUrl;
          audioLink.target = "_blank";
          audioLink.rel = "noopener";
          const durationText = formatDuration(Number(item.audioDurationSec || 0));
          audioLink.textContent = durationText ? `Open Audio (${durationText})` : "Open Audio";
          fileActions.appendChild(audioLink);
        }
        if (!item.pdfUrl && !item.audioUrl) {
          const unavailable = document.createElement("div");
          unavailable.className = "note";
          unavailable.textContent = "No packet files available for this judge yet.";
          row.appendChild(unavailable);
        }
        row.appendChild(fileActions);
        output.appendChild(row);
      });
    };

    const loadAssets = async () => {
      const result = await fetchDirectorPacketAssets({
        eventId: resolvedEventId,
        ensembleId: resolvedEnsembleId,
      });
      if (!result?.ok) {
        hint.textContent = result?.message || "Unable to load print files.";
        renderAssets(result || null);
        return;
      }
      state.admin.packetAssetsCache.set(cacheKey, result);
      renderAssets(result);
      hint.textContent = "Print files loaded.";
      loadBtn.textContent = "Refresh Print Files";
    };

    generateBtn.addEventListener("click", async () => {
      generateBtn.disabled = true;
      loadBtn.disabled = true;
      hint.textContent = "Generating print files...";
      try {
        await regenerateDirectorPacketExport({
          eventId: resolvedEventId,
          ensembleId: resolvedEnsembleId,
        });
        await loadAssets();
        hint.textContent = "Print files prepared.";
      } catch (error) {
        console.error("regenerateDirectorPacketExport failed", error);
        hint.textContent = error?.message || "Unable to prepare print files.";
      } finally {
        generateBtn.disabled = false;
        loadBtn.disabled = false;
      }
    });

    loadBtn.addEventListener("click", async () => {
      loadBtn.disabled = true;
      generateBtn.disabled = true;
      hint.textContent = "Loading print files...";
      try {
        await loadAssets();
      } finally {
        loadBtn.disabled = false;
        generateBtn.disabled = false;
      }
    });

    const cached = state.admin.packetAssetsCache.get(cacheKey);
    if (cached) {
      renderAssets(cached);
      loadBtn.textContent = "Refresh Print Files";
    }

    wrapper.appendChild(section);
  }

  function renderAdminOpenPacketPrintSection(packet, wrapper) {
    const packetId = String(packet?.id || "").trim();
    if (!packetId || !wrapper) return;
    if (!(state.admin.packetAssetsCache instanceof Map)) {
      state.admin.packetAssetsCache = new Map();
    }
    const cacheKey = `open:${packetId}`;
    const section = document.createElement("div");
    section.className = "panel stack";
    const title = document.createElement("strong");
    title.textContent = "Printable Open Sheet";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent =
      "Generate a printable PDF for this Open Judge sheet. Stage packets use the exact-match stage form template.";
    section.appendChild(title);
    section.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "row";
    const generateBtn = document.createElement("button");
    generateBtn.type = "button";
    generateBtn.className = "ghost";
    generateBtn.textContent = "Prepare Printable PDF";
    actions.appendChild(generateBtn);
    section.appendChild(actions);

    const output = document.createElement("div");
    output.className = "stack";
    section.appendChild(output);

    const renderAsset = (asset) => {
      output.innerHTML = "";
      if (!asset?.pdfUrl) {
        const empty = document.createElement("div");
        empty.className = "note";
        empty.textContent = "Printable PDF not generated yet.";
        output.appendChild(empty);
        return;
      }
      const row = document.createElement("div");
      row.className = "row";
      const openPdf = document.createElement("a");
      openPdf.className = "ghost";
      openPdf.href = asset.pdfUrl;
      openPdf.target = "_blank";
      openPdf.rel = "noopener";
      openPdf.textContent = "Open Printable PDF";
      const printPdf = document.createElement("a");
      printPdf.className = "ghost";
      printPdf.href = asset.pdfUrl;
      printPdf.target = "_blank";
      printPdf.rel = "noopener";
      printPdf.textContent = "Print PDF";
      row.appendChild(openPdf);
      row.appendChild(printPdf);
      output.appendChild(row);
    };

    generateBtn.addEventListener("click", async () => {
      generateBtn.disabled = true;
      hint.textContent = "Generating printable PDF...";
      try {
        const result = await generateOpenPacketPrintAsset({ packetId });
        state.admin.packetAssetsCache.set(cacheKey, result);
        renderAsset(result);
        hint.textContent = result?.pdfUrl
          ? "Printable PDF ready."
          : "Printable PDF generated, but no download URL was returned.";
        generateBtn.textContent = "Regenerate Printable PDF";
      } catch (error) {
        console.error("generateOpenPacketPrintAsset failed", error);
        hint.textContent = error?.message || "Unable to generate printable PDF.";
      } finally {
        generateBtn.disabled = false;
      }
    });

    const cached = state.admin.packetAssetsCache.get(cacheKey);
    if (cached) {
      renderAsset(cached);
      generateBtn.textContent = "Regenerate Printable PDF";
    }

    wrapper.appendChild(section);
  }

  function getManualAudioStatusMap() {
    if (!(state.admin.manualAudioUploadStatus instanceof Map)) {
      state.admin.manualAudioUploadStatus = new Map();
    }
    return state.admin.manualAudioUploadStatus;
  }

  function setManualAudioStatus(key, text, tone = "info") {
    getManualAudioStatusMap().set(String(key || ""), {
      text: String(text || ""),
      tone: tone === "error" ? "error" : "info",
      at: Date.now(),
    });
  }

  function readManualAudioStatus(key) {
    const item = getManualAudioStatusMap().get(String(key || ""));
    if (!item || !item.text) return "";
    const atLabel = item.at ? new Date(item.at).toLocaleTimeString() : "";
    return atLabel ? `${item.text} (${atLabel})` : item.text;
  }

  function normalizeJudgePosition(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return ["stage1", "stage2", "stage3", "sight"].includes(normalized) ? normalized : "";
  }

  function promptJudgePosition(initial = "stage1") {
    const answer = window.prompt(
      "Assign audio to judge position (stage1, stage2, stage3, sight):",
      initial
    );
    const value = normalizeJudgePosition(answer);
    if (!value) return "";
    return value;
  }

  async function pickAudioFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*,.wav,.mp3,.m4a,.aac,.webm,.ogg";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const file = input.files?.[0] || null;
        resolve(file);
      });
      document.body.appendChild(input);
      input.click();
      window.setTimeout(() => {
        if (input.parentNode) input.parentNode.removeChild(input);
      }, 0);
    });
  }

  function setAdminStepChip(el, { label, done = false, active = false } = {}) {
    if (!el) return;
    el.textContent = label || "";
    el.classList.toggle("is-done", Boolean(done));
    el.classList.toggle("is-active", Boolean(active));
  }

  function renderAdminPacketsWorkflowGuidance({
    hasActiveEvent = false,
    hasSchoolSelected = false,
    reviewedCount = 0,
    totalCount = 0,
    releaseReadyCount = 0,
    releasedCount = 0,
  } = {}) {
    if (!els.adminPacketsWorkflowCard) return;
    let step = "Start";
    let nextTitle = "Set an active event to begin.";
    let nextHint = "Then select a school and review packet completion before release.";

    if (hasActiveEvent && !hasSchoolSelected) {
      step = "Select School";
      nextTitle = "Select a school to load packet review.";
      nextHint = "Packets are grouped by school to reduce noise and keep release review focused.";
    } else if (hasActiveEvent && hasSchoolSelected && totalCount === 0) {
      step = "Review";
      nextTitle = "No scheduled packets found for this school.";
      nextHint = "Confirm schedules and submissions, then return to packet release.";
    } else if (hasActiveEvent && hasSchoolSelected && releaseReadyCount < totalCount) {
      step = "Review";
      nextTitle = "Review incomplete packets before release.";
      nextHint = `${releaseReadyCount}/${totalCount} packet(s) are ready to release.`;
    } else if (hasActiveEvent && hasSchoolSelected && releasedCount < totalCount) {
      step = "Release";
      nextTitle = "Release ready packets for the selected school.";
      nextHint = `${releasedCount}/${totalCount} packet(s) currently released.`;
    } else if (hasActiveEvent && hasSchoolSelected && totalCount > 0 && releasedCount >= totalCount) {
      step = "Done";
      nextTitle = "All packets for this school are released.";
      nextHint = "Use View Packet to spot-check content or manage Open Judge sheets.";
    }

    if (els.adminPacketsCurrentStepPill) els.adminPacketsCurrentStepPill.textContent = step;
    if (els.adminPacketsNextStepTitle) els.adminPacketsNextStepTitle.textContent = nextTitle;
    if (els.adminPacketsNextStepHint) els.adminPacketsNextStepHint.textContent = nextHint;

    setAdminStepChip(els.adminPacketsStepChipEvent, {
      label: "Event",
      done: hasActiveEvent,
      active: !hasActiveEvent,
    });
    setAdminStepChip(els.adminPacketsStepChipSchool, {
      label: "School",
      done: hasSchoolSelected,
      active: hasActiveEvent && !hasSchoolSelected,
    });
    setAdminStepChip(els.adminPacketsStepChipReview, {
      label: "Review",
      done: totalCount > 0 && reviewedCount >= totalCount,
      active: hasActiveEvent && hasSchoolSelected && totalCount > 0 && releaseReadyCount < totalCount,
    });
    setAdminStepChip(els.adminPacketsStepChipRelease, {
      label: "Release",
      done: totalCount > 0 && releasedCount >= totalCount,
      active: hasActiveEvent && hasSchoolSelected && totalCount > 0 && releaseReadyCount >= totalCount && releasedCount < totalCount,
    });
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
      audioUrl: packet.canonicalAudioUrl || packet.latestAudioUrl || "",
      audioPath: packet.canonicalAudioPath || "",
      audioSegments: Array.isArray(packet.audioSegments) ? packet.audioSegments : [],
      canonicalAudioStatus: packet.canonicalAudioStatus || "",
      canonicalAudioUrl: packet.canonicalAudioUrl || "",
      canonicalAudioPath: packet.canonicalAudioPath || "",
      canonicalAudioDurationSec: Number(packet.canonicalAudioDurationSec || packet.tapeDurationSec || 0),
      audioDurationSec: Number(packet.canonicalAudioDurationSec || packet.tapeDurationSec || 0),
      supplementalAudioUrl: packet.supplementalLatestAudioUrl || "",
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
          const aTime = toDateOrNull(a.performanceAt)?.getTime() || 0;
          const bTime = toDateOrNull(b.performanceAt)?.getTime() || 0;
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
        scheduleAdminPreflightRefresh?.({ immediate: true });
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
        const performanceAt = toDateOrNull(scheduleEntry?.performanceAt);
        const perfValue = performanceAt ? toLocalDatetimeValue(performanceAt) : "";
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
            scheduleAdminPreflightRefresh?.({ immediate: true });
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
            scheduleAdminPreflightRefresh?.({ immediate: true });
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
        renderAdminPacketsWorkflowGuidance({
          hasActiveEvent: false,
          hasSchoolSelected: false,
        });
        return;
      }
      els.adminPacketsHint.textContent = "Loading scheduled ensembles...";
      els.adminPacketsList.innerHTML = "";
      const appendBulkCleanupPanel = () => {
        const cleanupRow = document.createElement("li");
        cleanupRow.className = "panel";
        const cleanupTitle = document.createElement("h4");
        cleanupTitle.textContent = "Packet Cleanup";
        cleanupRow.appendChild(cleanupTitle);
        const cleanupHint = document.createElement("p");
        cleanupHint.className = "hint";
        cleanupHint.textContent = "Delete all unreleased scheduled packets and Open Judge sheets across the entire database.";
        cleanupRow.appendChild(cleanupHint);
        const cleanupBtn = document.createElement("button");
        cleanupBtn.type = "button";
        cleanupBtn.className = "ghost";
        cleanupBtn.textContent = "Delete All Unreleased Packets";
        cleanupBtn.addEventListener("click", async () => {
          const confirmed = confirmUser(
            "Delete all unreleased packets across the entire database? Released packets will be skipped."
          );
          if (!confirmed) return;
          const phrase = window.prompt("Type DELETE UNRELEASED to confirm bulk cleanup.");
          if (phrase !== "DELETE UNRELEASED") {
            alertUser("Bulk cleanup cancelled: confirmation phrase did not match.");
            return;
          }
          cleanupBtn.disabled = true;
          try {
            const result = await deleteAllUnreleasedPackets();
            await renderAdminPacketsBySchedule();
            alertUser(
              `Cleanup complete. Open deleted: ${result.deletedOpenPackets || 0}; scheduled deleted: ${result.deletedScheduledPackets || 0}; released skipped: ${(result.skippedReleasedOpenPackets || 0) + (result.skippedReleasedScheduledPackets || 0)}.`
            );
          } catch (error) {
            console.error("Bulk delete unreleased packets failed", error);
            alertUser(error?.message || "Unable to delete unreleased packets.");
          } finally {
            cleanupBtn.disabled = false;
          }
        });
        cleanupRow.appendChild(cleanupBtn);
        const cleanupTestBtn = document.createElement("button");
        cleanupTestBtn.type = "button";
        cleanupTestBtn.className = "ghost danger";
        cleanupTestBtn.textContent = "Delete Test Data";
        cleanupTestBtn.addEventListener("click", async () => {
          cleanupTestBtn.disabled = true;
          try {
            const preview = await cleanupTestArtifacts({ dryRun: true });
            const eventCount = Number(preview.eventCandidates?.length || 0);
            const schoolCount = Number(preview.schoolCandidates?.length || 0);
            const suggestedEventCount = Number(preview.suggestedEventMatches?.length || 0);
            const suggestedSchoolCount = Number(preview.suggestedSchoolMatches?.length || 0);
            const packetCount = Number(preview.packetCandidates || 0);
            const submissionCount = Number(preview.submissionCandidates || 0);
            if (!eventCount && !schoolCount && !packetCount && !submissionCount) {
              if (suggestedEventCount || suggestedSchoolCount) {
                alertUser(
                  `No explicitly tagged test artifacts found.\n` +
                  `Suggested matches (not deleted in strict mode): events ${suggestedEventCount}, schools ${suggestedSchoolCount}.\n` +
                  `Tag records with isTestArtifact=true to enable safe cleanup.`
                );
              } else {
                alertUser("No test artifacts matched the cleanup rules.");
              }
              return;
            }
            const confirmed = confirmUser(
              `Test cleanup preview:\n` +
              `Events: ${eventCount}\n` +
              `Schools: ${schoolCount}\n` +
              `Open packets: ${packetCount}\n` +
              `Scheduled submissions: ${submissionCount}\n` +
              `Strict mode: ${preview.strictMode === true ? "on" : "off"}\n` +
              `Active event skipped: ${Number(preview.activeEventSkipped?.length || 0)}\n\n` +
              "Proceed with permanent deletion?"
            );
            if (!confirmed) return;
            const phrase = window.prompt("Type DELETE TEST DATA to confirm.");
            if (phrase !== "DELETE TEST DATA") {
              alertUser("Test cleanup cancelled: confirmation phrase did not match.");
              return;
            }
            const result = await cleanupTestArtifacts({ dryRun: false });
            await renderAdminPacketsBySchedule();
            alertUser(
              `Test cleanup complete.\n` +
              `Deleted events: ${result.deletedEvents || 0}\n` +
              `Deleted schools: ${result.deletedSchools || 0}\n` +
              `Deleted open packets: ${result.deletedOpenPackets || 0}\n` +
              `Deleted scheduled submissions: ${result.deletedSubmissions || 0}\n` +
              `Deleted audio-only rows: ${result.deletedAudioResults || 0}`
            );
          } catch (error) {
            console.error("cleanupTestArtifacts failed", error);
            alertUser(error?.message || "Unable to cleanup test artifacts.");
          } finally {
            cleanupTestBtn.disabled = false;
          }
        });
        cleanupRow.appendChild(cleanupTestBtn);
        const repairBtn = document.createElement("button");
        repairBtn.type = "button";
        repairBtn.className = "ghost";
        repairBtn.textContent = "Repair Audio Links";
        repairBtn.addEventListener("click", async () => {
          const runDry = window.confirm(
            "Run a DRY RUN first?\nOK = Dry run only (safe preview)\nCancel = Apply fixes now"
          );
          repairBtn.disabled = true;
          try {
            const result = await repairManualAudioOverrides({ dryRun: runDry });
            await renderAdminPacketsBySchedule();
            alertUser(
              `${runDry ? "Dry run complete" : "Audio repair complete"}.\n` +
              `Submissions updated: ${result.submissionsUpdated || 0}\n` +
              `Open packets updated: ${result.packetsUpdated || 0}\n` +
              `Skipped (no canonical tape found): ${result.skippedNoCanonical || 0}`
            );
          } catch (error) {
            console.error("repairManualAudioOverrides failed", error);
            alertUser(error?.message || "Unable to repair audio links.");
          } finally {
            repairBtn.disabled = false;
          }
        });
        cleanupRow.appendChild(repairBtn);
        const repairOpenTapeBtn = document.createElement("button");
        repairOpenTapeBtn.type = "button";
        repairOpenTapeBtn.className = "ghost";
        repairOpenTapeBtn.textContent = "Repair Open Tape Metadata";
        repairOpenTapeBtn.addEventListener("click", async () => {
          const runDry = window.confirm(
            "Run a DRY RUN first?\nOK = Dry run only (safe preview)\nCancel = Apply fixes now"
          );
          repairOpenTapeBtn.disabled = true;
          try {
            const result = await repairOpenSubmissionAudioMetadata({ dryRun: runDry });
            await renderAdminPacketsBySchedule();
            alertUser(
              `${runDry ? "Dry run complete" : "Open tape metadata repair complete"}.\n` +
              `Open packets updated: ${result.packetsUpdated || 0}\n` +
              `Official submissions updated: ${result.submissionsUpdated || 0}\n` +
              `Packet exports updated: ${result.exportsUpdated || 0}\n` +
              `Skipped (no sessions): ${result.skippedNoSessions || 0}\n` +
              `Skipped (no official submission): ${result.skippedNoSubmission || 0}`
            );
          } catch (error) {
            console.error("repairOpenSubmissionAudioMetadata failed", error);
            alertUser(error?.message || "Unable to repair open tape metadata.");
          } finally {
            repairOpenTapeBtn.disabled = false;
          }
        });
        cleanupRow.appendChild(repairOpenTapeBtn);
        els.adminPacketsList.appendChild(cleanupRow);
      };
      appendBulkCleanupPanel();
      renderAdminPacketsWorkflowGuidance({
        hasActiveEvent: true,
        hasSchoolSelected: Boolean(state.admin.packetsSchoolId),
      });

      const scheduleEntries = await fetchScheduleEntries(eventId);
      if (state.admin.currentView !== "packets" || (state.event.active?.id || "") !== eventId) return;

      const ordered = [...(scheduleEntries || [])].sort((a, b) => {
        const aMs = toDateOrNull(a.performanceAt)?.getTime() || 0;
        const bMs = toDateOrNull(b.performanceAt)?.getTime() || 0;
        return aMs - bMs;
      });
      if (!ordered.length) {
        els.adminPacketsHint.textContent = "No scheduled ensembles for the active event.";
        els.adminPacketsSchoolSelect.innerHTML = "";
        renderAdminPacketsWorkflowGuidance({
          hasActiveEvent: true,
          hasSchoolSelected: false,
          totalCount: 0,
        });
        return;
      }

      const schools = [];
      const seenSchoolIds = new Set();
      (state.admin.schoolsList || []).forEach((school) => {
        const schoolId = String(school.id || "").trim();
        if (!schoolId || seenSchoolIds.has(schoolId)) return;
        seenSchoolIds.add(schoolId);
        schools.push({
          schoolId,
          schoolName: String(school.name || schoolId),
        });
      });
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
        renderAdminPacketsWorkflowGuidance({
          hasActiveEvent: true,
          hasSchoolSelected: false,
        });
        return;
      }
      const filtered = ordered.filter((entry) => (entry.schoolId || "") === state.admin.packetsSchoolId);
      if (!filtered.length) {
        els.adminPacketsHint.textContent =
          "No scheduled ensembles found for this school. Loading Open Judge sheets...";
      } else {
        els.adminPacketsHint.textContent = "Loading packet status for selected school...";
      }
      const packetDataByEntryId = new Map();
      if (filtered.length) {
        const packetPayloads = await Promise.all(
          filtered.map(async (entry) => {
            const packetData = await getPacketData({ eventId, entry });
            return { entryId: entry.id, packetData };
          })
        );
        if (state.admin.currentView !== "packets" || (state.event.active?.id || "") !== eventId) return;
        packetPayloads.forEach(({ entryId, packetData }) => {
          if (!entryId) return;
          packetDataByEntryId.set(entryId, packetData);
        });
      }
      let reviewedCount = 0;
      let releaseReadyCount = 0;
      let releasedCount = 0;
      const audioResultsByEnsemble = new Map();
      const audioResultRows = await getDocs(
        query(
          collection(db, COLLECTIONS.audioResults),
          where("eventId", "==", eventId),
          where("schoolId", "==", state.admin.packetsSchoolId)
        )
      );
      audioResultRows.docs.forEach((docSnap) => {
        const data = { id: docSnap.id, ...docSnap.data() };
        const key = String(data.ensembleId || "");
        if (!key) return;
        if (!audioResultsByEnsemble.has(key)) audioResultsByEnsemble.set(key, []);
        audioResultsByEnsemble.get(key).push(data);
      });

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
        const packetData = packetDataByEntryId.get(entry.id) || null;
        const summary = packetData?.summary || null;
        reviewedCount += 1;
        if (summary?.requiredComplete) releaseReadyCount += 1;
        if (summary?.requiredReleased) releasedCount += 1;
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
            scheduleAdminPreflightRefresh?.({ immediate: true });
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("Update packet release failed", error);
            alertUser(formatBlockerError(error, "Unable to update packet release state."));
          } finally {
            releaseBtn.disabled = false;
          }
        });
        actions.appendChild(releaseBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ghost";
        deleteBtn.textContent = "Delete Packet";
        if (summary?.requiredReleased) {
          deleteBtn.disabled = true;
          deleteBtn.title = "Unrelease packet first.";
        }
        deleteBtn.addEventListener("click", async () => {
          const ok = confirmUser(
            `Delete scheduled packet for ${schoolName} - ${ensembleName}? This removes all judge submissions and packet export.`
          );
          if (!ok) return;
          deleteBtn.disabled = true;
          try {
            await deleteScheduledPacket({ eventId, ensembleId });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("Delete scheduled packet failed", error);
            alertUser(error?.message || "Unable to delete scheduled packet.");
          } finally {
            deleteBtn.disabled = false;
          }
        });
        actions.appendChild(deleteBtn);

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
            renderAdminPacketAssetsSection({ eventId, ensembleId }, panel);
          } else {
            panel.classList.add("is-hidden");
            viewBtn.textContent = "View Packet";
          }
        });
        actions.appendChild(viewBtn);

        const attachAudioBtn = document.createElement("button");
        attachAudioBtn.type = "button";
        attachAudioBtn.className = "ghost";
        attachAudioBtn.textContent = "Attach Audio";
        attachAudioBtn.addEventListener("click", async () => {
          const scheduledStatusKey = `scheduled:${eventId}:${ensembleId}`;
          const judgePosition = promptJudgePosition("stage1");
          if (!judgePosition) {
            alertUser("Choose stage1, stage2, stage3, or sight.");
            return;
          }
          const file = await pickAudioFile();
          if (!file) return;
          setManualAudioStatus(
            scheduledStatusKey,
            `Uploading ${file.name} to ${judgePosition}...`
          );
          await renderAdminPacketsBySchedule();
          attachAudioBtn.disabled = true;
          try {
            await attachManualAudioToScheduledPacket({
              eventId,
              ensembleId,
              judgePosition,
              file,
            });
            setManualAudioStatus(
              scheduledStatusKey,
              `Upload complete. Attached to ${judgePosition}.`
            );
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("Attach scheduled packet audio failed", error);
            setManualAudioStatus(
              scheduledStatusKey,
              `Upload failed: ${error?.message || "Unable to attach audio."}`,
              "error"
            );
            await renderAdminPacketsBySchedule();
          } finally {
            attachAudioBtn.disabled = false;
          }
        });
        actions.appendChild(attachAudioBtn);

        const audioOnlyBtn = document.createElement("button");
        audioOnlyBtn.type = "button";
        audioOnlyBtn.className = "ghost";
        audioOnlyBtn.textContent = "Upload Audio-Only";
        audioOnlyBtn.addEventListener("click", async () => {
          const scheduledStatusKey = `scheduled:${eventId}:${ensembleId}`;
          const file = await pickAudioFile();
          if (!file) return;
          const judgePosition = normalizeJudgePosition(
            window.prompt("Optional judge position (stage1, stage2, stage3, sight):", "")
          );
          setManualAudioStatus(scheduledStatusKey, `Uploading audio-only file ${file.name}...`);
          await renderAdminPacketsBySchedule();
          audioOnlyBtn.disabled = true;
          try {
            const created = await createAudioOnlyResultFromFile({
              eventId,
              schoolId: entry.schoolId,
              ensembleId,
              ensembleName,
              judgePosition,
              mode: "official",
              file,
            });
            const shouldRelease = window.confirm("Release this audio-only result to directors now?");
            if (shouldRelease && created?.audioResultId) {
              setManualAudioStatus(scheduledStatusKey, "Upload complete. Releasing audio-only result...");
              await renderAdminPacketsBySchedule();
              await releaseAudioOnlyResult({ audioResultId: created.audioResultId });
            }
            setManualAudioStatus(
              scheduledStatusKey,
              shouldRelease ?
                "Audio-only upload complete and released." :
                "Audio-only upload complete (draft, not released)."
            );
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("Upload audio-only result failed", error);
            setManualAudioStatus(
              scheduledStatusKey,
              `Audio-only upload failed: ${error?.message || "Unable to upload audio-only result."}`,
              "error"
            );
            await renderAdminPacketsBySchedule();
          } finally {
            audioOnlyBtn.disabled = false;
          }
        });
        actions.appendChild(audioOnlyBtn);
        li.appendChild(actions);
        const scheduledStatus = readManualAudioStatus(`scheduled:${eventId}:${ensembleId}`);
        if (scheduledStatus) {
          const statusRow = document.createElement("div");
          statusRow.className = "note";
          statusRow.textContent = `Audio Upload Status: ${scheduledStatus}`;
          li.appendChild(statusRow);
        }
        li.appendChild(panel);

        const audioOnlyRows = audioResultsByEnsemble.get(ensembleId) || [];
        if (audioOnlyRows.length) {
          const audioOnlyWrap = document.createElement("div");
          audioOnlyWrap.className = "stack";
          const audioOnlyTitle = document.createElement("div");
          audioOnlyTitle.className = "note";
          audioOnlyTitle.textContent = `Audio-only results: ${audioOnlyRows.length}`;
          audioOnlyWrap.appendChild(audioOnlyTitle);
          audioOnlyRows.forEach((item) => {
            const rowMeta = document.createElement("div");
            rowMeta.className = "row row--between";
            const left = document.createElement("span");
            const status = String(item.status || "draft");
            const label = item.judgePosition ? ` (${item.judgePosition})` : "";
            left.textContent = `Audio-only${label} - ${status}`;
            const controls = document.createElement("div");
            controls.className = "row";
            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "ghost";
            const shouldUnrelease = status === "released";
            toggleBtn.textContent = shouldUnrelease ? "Unrelease" : "Release";
            toggleBtn.addEventListener("click", async () => {
              toggleBtn.disabled = true;
              try {
                if (shouldUnrelease) {
                  await unreleaseAudioOnlyResult({ audioResultId: item.id });
                } else {
                  await releaseAudioOnlyResult({ audioResultId: item.id });
                }
                await renderAdminPacketsBySchedule();
              } catch (error) {
                console.error("Toggle audio-only release failed", error);
                alertUser(error?.message || "Unable to update audio-only release.");
              } finally {
                toggleBtn.disabled = false;
              }
            });
            controls.appendChild(toggleBtn);
            rowMeta.appendChild(left);
            rowMeta.appendChild(controls);
            audioOnlyWrap.appendChild(rowMeta);
          });
          li.appendChild(audioOnlyWrap);
        }
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
          const packetEventId = String(packet.assignmentEventId || packet.officialEventId || "").trim();
          return packetEventId === eventId || !packetEventId;
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
      openHint.textContent =
        "Individual Open Judge tapes for this school (active event + unscheduled open sheets).";
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
          const modeBadge = document.createElement("span");
          modeBadge.className = "badge";
          modeBadge.textContent =
            String(packet.mode || "practice").toLowerCase() === "official"
              ? "OFFICIAL"
              : "PRACTICE";
          badges.appendChild(modeBadge);
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
                  scheduleAdminPreflightRefresh?.({ immediate: true });
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
              releaseBtn.textContent = shouldUnrelease ? "Unrelease from Director" : "Release to Director";
              releaseBtn.addEventListener("click", async () => {
                releaseBtn.disabled = true;
                try {
                  if (shouldUnrelease) {
                    await unreleaseOpenPacket({ packetId: packet.id });
                  } else {
                    await releaseOpenPacket({ packetId: packet.id });
                  }
                  scheduleAdminPreflightRefresh?.({ immediate: true });
                  await renderAdminPacketsBySchedule();
                } catch (error) {
                  console.error("Open packet release/unrelease failed", error);
                  alertUser(formatBlockerError(error, "Unable to update open sheet release state."));
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
              renderAdminOpenPacketPrintSection(packet, detail);
            }
          });
          actions.appendChild(viewBtn);

          const attachOpenAudioBtn = document.createElement("button");
          attachOpenAudioBtn.type = "button";
          attachOpenAudioBtn.className = "ghost";
          attachOpenAudioBtn.textContent = "Attach Audio";
          attachOpenAudioBtn.addEventListener("click", async () => {
            const openStatusKey = `open:${packet.id}`;
            const file = await pickAudioFile();
            if (!file) return;
            setManualAudioStatus(openStatusKey, `Uploading ${file.name}...`);
            await renderAdminPacketsBySchedule();
            attachOpenAudioBtn.disabled = true;
            try {
              await attachManualAudioToOpenPacket({ packetId: packet.id, file });
              setManualAudioStatus(openStatusKey, "Upload complete. Audio attached to open sheet.");
              await renderAdminPacketsBySchedule();
            } catch (error) {
              console.error("Attach open packet audio failed", error);
              setManualAudioStatus(
                openStatusKey,
                `Upload failed: ${error?.message || "Unable to attach open sheet audio."}`,
                "error"
              );
              await renderAdminPacketsBySchedule();
            } finally {
              attachOpenAudioBtn.disabled = false;
            }
          });
          actions.appendChild(attachOpenAudioBtn);

          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "ghost";
          deleteBtn.textContent = "Delete Open Sheet";
          const openStatus = normalizeOpenPacketStatus(packet.status);
          if (openStatus === "released") {
            deleteBtn.disabled = true;
            deleteBtn.title = "Unrelease open sheet first.";
          }
          deleteBtn.addEventListener("click", async () => {
            const label = `${packet.schoolName || "School"} - ${packet.ensembleName || "Ensemble"}`;
            const ok = confirmUser(
              `Delete Open Judge sheet for ${label}? This removes packet audio and sessions.`
            );
            if (!ok) return;
            deleteBtn.disabled = true;
            try {
              await deleteOpenPacket({ packetId: packet.id });
              scheduleAdminPreflightRefresh?.({ immediate: true });
              await renderAdminPacketsBySchedule();
            } catch (error) {
              console.error("Delete open packet failed", error);
              alertUser(error?.message || "Unable to delete open sheet.");
            } finally {
              deleteBtn.disabled = false;
            }
          });
          actions.appendChild(deleteBtn);
          row.appendChild(actions);
          const openStatusText = readManualAudioStatus(`open:${packet.id}`);
          if (openStatusText) {
            const statusRow = document.createElement("div");
            statusRow.className = "note";
            statusRow.textContent = `Audio Upload Status: ${openStatusText}`;
            row.appendChild(statusRow);
          }
          row.appendChild(detail);
          openList.appendChild(row);
        });
        openSection.appendChild(openList);
      }
      els.adminPacketsList.appendChild(openSection);
      els.adminPacketsHint.textContent = "";
      renderAdminPacketsWorkflowGuidance({
        hasActiveEvent: true,
        hasSchoolSelected: true,
        reviewedCount,
        totalCount: filtered.length,
        releaseReadyCount,
        releasedCount,
      });
    } catch (error) {
      console.error("renderAdminPacketsBySchedule failed", error);
      if (els.adminPacketsHint) {
        els.adminPacketsHint.textContent = "Unable to load packet review right now.";
      }
      renderAdminPacketsWorkflowGuidance({
        hasActiveEvent: Boolean(state.event.active?.id),
        hasSchoolSelected: Boolean(state.admin.packetsSchoolId),
      });
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

      const [registeredRaw, scheduleEntries, entriesSnap] = await Promise.all([
        fetchRegisteredEnsembles(eventId),
        fetchScheduleEntries(eventId),
        getDocs(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries)),
      ]);
      state.event.rosterEntries = Array.isArray(scheduleEntries) ? [...scheduleEntries] : [];
      await refreshPreEventScheduleTimelineStarts?.(state.event.rosterEntries);
      const { active: registered, stale } = await resolveCurrentRegisteredEnsembles(eventId, registeredRaw);

      if (!registered.length) {
        const staleHint = stale.length
          ? `<li class='hint'>No current ensembles are registered. Hidden stale entries: ${stale.length}.</li>`
          : "<li class='hint'>No ensembles have registered yet.</li>";
        els.adminRegisteredEnsemblesList.innerHTML = staleHint;
        schedulePreEventGuidedFlowRender();
        return;
      }

      if (stale.length) {
        const staleLi = document.createElement("li");
        staleLi.className = "hint";
        staleLi.textContent = `Hidden stale registrations: ${stale.length} (ensembles no longer in school list).`;
        els.adminRegisteredEnsemblesList.appendChild(staleLi);
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
