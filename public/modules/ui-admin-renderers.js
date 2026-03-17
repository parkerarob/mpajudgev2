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
  officializeRawAssessment,
  excludeRawAssessment,
  reassignRawAssessment,
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
  renderAssessmentCard,
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
  const JUDGE_POSITION_LABELS = {
    stage1: "Stage 1",
    stage2: "Stage 2",
    stage3: "Stage 3",
    sight: "Sight",
  };

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

  function formatRawAssessmentStatus(value) {
    const normalized = String(value || "").trim() || "draft";
    return normalized.replace(/_/g, " ");
  }

  function formatJudgeRatingLabel(value) {
    const label = String(value || "").trim();
    return label || "N/A";
  }

  function formatCaptionKeyLabel(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim() || "Caption";
  }

  function buildRawAssessmentQueue() {
    const filter = String(state.admin.rawAssessmentFilter || "pending").trim();
    const items = Array.isArray(state.admin.rawAssessments) ? state.admin.rawAssessments : [];
    const eventId = String(state.event.active?.id || "").trim();
    return items.filter((item) => {
      if (eventId && item.eventId && String(item.eventId).trim() !== eventId) return false;
      if (filter === "all") return true;
      if (filter === "attached") return String(item.associationState || "") === "attached";
      if (filter === "uncertain") return String(item.associationState || "") !== "attached";
      if (filter === "officialized") return String(item.status || "") === "officialized";
      if (filter === "excluded") return String(item.status || "") === "excluded";
      return String(item.reviewState || "") === "pending" || String(item.status || "") === "submitted";
    });
  }

  function getLiveSubmissionTargetCache(eventId) {
    const activeEventId = String(eventId || "").trim();
    if (!activeEventId) return [];
    if (state.admin.liveSubmissionTargetsEventId !== activeEventId) {
      state.admin.liveSubmissionTargetsEventId = activeEventId;
      state.admin.liveSubmissionTargets = [];
      state.admin.liveSubmissionTargetsLoading = false;
    }
    return Array.isArray(state.admin.liveSubmissionTargets) ? state.admin.liveSubmissionTargets : [];
  }

  async function ensureLiveSubmissionTargets(eventId) {
    const activeEventId = String(eventId || "").trim();
    if (!activeEventId || state.admin.liveSubmissionTargetsLoading) return;
    const cachedTargets = getLiveSubmissionTargetCache(activeEventId);
    if (cachedTargets.length) return;
    state.admin.liveSubmissionTargetsLoading = true;
    try {
      const [scheduleEntries, registeredRaw] = await Promise.all([
        fetchScheduleEntries(activeEventId).catch(() => []),
        fetchRegisteredEnsembles(activeEventId).catch(() => []),
      ]);
      const { active: registered } = await resolveCurrentRegisteredEnsembles(activeEventId, registeredRaw);
      const targetMap = new Map();
      [...scheduleEntries, ...registered].forEach((entry) => {
        const schoolId = String(entry.schoolId || "").trim();
        const ensembleId = String(entry.ensembleId || entry.id || "").trim();
        if (!schoolId || !ensembleId) return;
        const key = `${schoolId}::${ensembleId}`;
        const existing = targetMap.get(key) || {};
        targetMap.set(key, {
          schoolId,
          ensembleId,
          schoolName:
            String(entry.schoolName || "").trim() ||
            existing.schoolName ||
            getSchoolNameById(state.admin.schoolsList, schoolId) ||
            schoolId,
          ensembleName:
            String(entry.ensembleName || entry.name || "").trim() ||
            existing.ensembleName ||
            ensembleId,
          eventId: String(entry.eventId || activeEventId).trim(),
          orderIndex: Number.isFinite(Number(entry.orderIndex))
            ? Number(entry.orderIndex)
            : (Number.isFinite(Number(existing.orderIndex)) ? Number(existing.orderIndex) : Number.MAX_SAFE_INTEGER),
        });
      });
      state.admin.liveSubmissionTargets = Array.from(targetMap.values()).sort((a, b) => {
        const aOrder = Number(a.orderIndex);
        const bOrder = Number(b.orderIndex);
        if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) return aOrder - bOrder;
        const aLabel = `${a.schoolName || ""} ${a.ensembleName || a.ensembleId || ""}`.toLowerCase();
        const bLabel = `${b.schoolName || ""} ${b.ensembleName || b.ensembleId || ""}`.toLowerCase();
        return aLabel.localeCompare(bLabel);
      });
      if (!state.event.rosterEntries?.length && scheduleEntries.length) {
        state.event.rosterEntries = [...scheduleEntries];
      }
    } catch (error) {
      console.warn("ensureLiveSubmissionTargets failed", { eventId: activeEventId, error });
    } finally {
      state.admin.liveSubmissionTargetsLoading = false;
      if (state.admin.currentView === "submissions") {
        renderAdminLiveSubmissions();
      }
    }
  }

  function resolveSubmissionTargetOptions(item) {
    const eventId = String(state.event.active?.id || item?.eventId || "").trim();
    const cachedTargets = getLiveSubmissionTargetCache(eventId);
    if (!cachedTargets.length) {
      ensureLiveSubmissionTargets(eventId);
    }
    const rosterFallback = (Array.isArray(state.event.rosterEntries) ? state.event.rosterEntries : [])
      .filter((entry) => !eventId || String(entry.eventId || state.event.active?.id || "").trim() === eventId)
      .map((entry) => ({
        schoolId: String(entry.schoolId || "").trim(),
        ensembleId: String(entry.ensembleId || entry.id || "").trim(),
        schoolName:
          String(entry.schoolName || "").trim() ||
          getSchoolNameById(state.admin.schoolsList, entry.schoolId) ||
          String(entry.schoolId || "").trim(),
        ensembleName: String(entry.ensembleName || entry.name || "").trim(),
        eventId,
        orderIndex: Number.isFinite(Number(entry.orderIndex)) ? Number(entry.orderIndex) : Number.MAX_SAFE_INTEGER,
      }))
      .filter((entry) => entry.schoolId && entry.ensembleId);
    const targetMap = new Map();
    [...cachedTargets, ...rosterFallback].forEach((entry) => {
      const key = `${entry.schoolId}::${entry.ensembleId}`;
      if (!targetMap.has(key)) targetMap.set(key, entry);
    });
    const selectedSchoolId = String(item?.schoolId || "").trim();
    const selectedEnsembleId = String(item?.ensembleId || "").trim();
    if (selectedSchoolId && selectedEnsembleId) {
      const key = `${selectedSchoolId}::${selectedEnsembleId}`;
      if (!targetMap.has(key)) {
        targetMap.set(key, {
          schoolId: selectedSchoolId,
          ensembleId: selectedEnsembleId,
          schoolName: getSchoolNameById(state.admin.schoolsList, selectedSchoolId) || selectedSchoolId,
          ensembleName: selectedEnsembleId,
          eventId,
          orderIndex: Number.MAX_SAFE_INTEGER,
        });
      }
    }
    return Array.from(targetMap.values()).sort((a, b) => {
      const aOrder = Number(a.orderIndex);
      const bOrder = Number(b.orderIndex);
      if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) return aOrder - bOrder;
      const aLabel = `${a.schoolName || ""} ${a.ensembleName || a.ensembleId || ""}`.toLowerCase();
      const bLabel = `${b.schoolName || ""} ${b.ensembleName || b.ensembleId || ""}`.toLowerCase();
      return aLabel.localeCompare(bLabel);
    });
  }

  function renderAdminLiveSubmissions() {
    if (!els.adminSubmissionsList || !els.adminSubmissionDetail) return;
    const items = buildRawAssessmentQueue();
    if (!state.admin.selectedRawAssessmentId || !items.some((item) => item.id === state.admin.selectedRawAssessmentId)) {
      state.admin.selectedRawAssessmentId = items[0]?.id || "";
    }
    const selected = items.find((item) => item.id === state.admin.selectedRawAssessmentId) || null;
    const totalCount = items.length;
    const pendingCount = items.filter((item) => {
      const reviewState = String(item.reviewState || "").trim();
      const status = String(item.status || "").trim();
      return reviewState === "pending" || status === "submitted";
    }).length;
    const officializedCount = items.filter((item) => String(item.status || "").trim() === "officialized").length;
    renderAdminSubmissionsWorkflowGuidance({
      hasActiveEvent: Boolean(state.event.active?.id),
      totalCount,
      pendingCount,
      officializedCount,
      hasSelection: Boolean(selected),
    });
    if (els.adminSubmissionsFilter && els.adminSubmissionsFilter.value !== (state.admin.rawAssessmentFilter || "pending")) {
      els.adminSubmissionsFilter.value = state.admin.rawAssessmentFilter || "pending";
    }
    if (els.adminSubmissionsHint) {
      els.adminSubmissionsHint.textContent = items.length
        ? `${items.length} assessment${items.length === 1 ? "" : "s"} in queue.`
        : "No assessments in this filter.";
    }
    els.adminSubmissionsList.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "list-item";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-school-row-btn";
      const targetOptions = resolveSubmissionTargetOptions(item);
      const matchedTarget = targetOptions.find(
        (entry) =>
          String(entry.schoolId || "") === String(item.schoolId || "") &&
          String(entry.ensembleId || "") === String(item.ensembleId || "")
      );
      const schoolLabel =
        matchedTarget?.schoolName ||
        getSchoolNameById(state.admin.schoolsList, item.schoolId) ||
        item.schoolId ||
        "School";
      const ensembleLabel = normalizeEnsembleDisplayName({
        schoolName: schoolLabel,
        ensembleName: matchedTarget?.ensembleName || item.ensembleName,
        ensembleId: item.ensembleId,
      }) || "Unassigned ensemble";
      const title = document.createElement("strong");
      title.textContent = `${schoolLabel} - ${ensembleLabel}`;
      const meta = document.createElement("div");
      meta.className = "note";
      meta.textContent = [
        item.judgeName || item.judgeEmail || "Unknown judge",
        item.judgePosition || "No position",
        formatRawAssessmentStatus(item.status),
        String(item.associationState || "uncertain"),
      ].filter(Boolean).join(" • ");
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener("click", () => {
        state.admin.selectedRawAssessmentId = item.id;
        renderAdminLiveSubmissions();
      });
      li.appendChild(btn);
      els.adminSubmissionsList.appendChild(li);
    });

    els.adminSubmissionDetail.innerHTML = "";
    if (!selected) {
      const empty = document.createElement("div");
      empty.className = "stack";
      const emptyNote = document.createElement("div");
      emptyNote.className = "note";
      emptyNote.textContent = items.length
        ? "Select an assessment to review."
        : state.event.active?.id
          ? "No assessments are waiting in this queue."
          : "Set an active event to begin reviewing assessments.";
      empty.appendChild(emptyNote);
      const actions = document.createElement("div");
      actions.className = "row";
      const primaryBtn = document.createElement("button");
      primaryBtn.type = "button";
      primaryBtn.className = "ghost";
      if (state.event.active?.id) {
        primaryBtn.textContent = "Open Judge Workspace";
        primaryBtn.addEventListener("click", () => {
          window.location.hash = "#judge-open";
        });
      } else {
        primaryBtn.textContent = "Open Settings";
        primaryBtn.addEventListener("click", () => {
          window.location.hash = "#admin/settings";
        });
      }
      actions.appendChild(primaryBtn);
      if (state.event.active?.id) {
        const packetsBtn = document.createElement("button");
        packetsBtn.type = "button";
        packetsBtn.className = "ghost";
        packetsBtn.textContent = "Open Packets & Results";
        packetsBtn.addEventListener("click", () => {
          window.location.hash = "#admin/packets";
        });
        actions.appendChild(packetsBtn);
      }
      empty.appendChild(actions);
      els.adminSubmissionDetail.appendChild(empty);
      return;
    }

    const detailTargets = resolveSubmissionTargetOptions(selected);
    const matchedDetailTarget = detailTargets.find(
      (entry) =>
        String(entry.schoolId || "") === String(selected.schoolId || "") &&
        String(entry.ensembleId || "") === String(selected.ensembleId || "")
    );
    const detailSchoolLabel =
      matchedDetailTarget?.schoolName ||
      getSchoolNameById(state.admin.schoolsList, selected.schoolId) ||
      selected.schoolId ||
      "School";
    const detailEnsembleLabel = normalizeEnsembleDisplayName({
      schoolName: detailSchoolLabel,
      ensembleName: matchedDetailTarget?.ensembleName || selected.ensembleName,
      ensembleId: selected.ensembleId,
    }) || selected.ensembleId || "No ensemble";

    const title = document.createElement("h4");
    title.textContent = selected.judgeName || selected.judgeEmail || selected.id;
    const meta = document.createElement("div");
    meta.className = "note";
    meta.textContent = [
      selected.eventId || state.event.active?.id || "No event",
      `${detailSchoolLabel} - ${detailEnsembleLabel}`,
      selected.judgePosition || "No position",
      `Status ${formatRawAssessmentStatus(selected.status)}`,
      `Association ${selected.associationState || "uncertain"}`,
    ].join(" • ");
    els.adminSubmissionDetail.appendChild(title);
    els.adminSubmissionDetail.appendChild(meta);

    if (selected.audioUrl) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.className = "audio";
      audio.src = selected.audioUrl;
      els.adminSubmissionDetail.appendChild(audio);
    }

    const commentsLabel = document.createElement("strong");
    commentsLabel.textContent = "Transcript / Reference Notes";
    els.adminSubmissionDetail.appendChild(commentsLabel);
    const comments = document.createElement("div");
    comments.className = "note";
    comments.textContent =
      selected.writtenComments || selected.transcript || "No transcript or reference notes saved.";
    els.adminSubmissionDetail.appendChild(comments);

    const scoringMeta = document.createElement("div");
    scoringMeta.className = "note";
    scoringMeta.textContent = [
      `Judge Overall Rating ${formatJudgeRatingLabel(selected.computedFinalRatingLabel)}`,
      Number.isFinite(Number(selected.captionScoreTotal))
        ? `Caption Total ${Number(selected.captionScoreTotal)}`
        : "Caption Total N/A",
    ].join(" • ");
    els.adminSubmissionDetail.appendChild(scoringMeta);

    const captions = selected.captions && typeof selected.captions === "object"
      ? selected.captions
      : {};
    const captionKeys = Object.keys(captions);
    const captionSection = document.createElement("div");
    captionSection.className = "stack";
    const captionTitle = document.createElement("strong");
    captionTitle.textContent = "Caption Scoring";
    captionSection.appendChild(captionTitle);
    if (!captionKeys.length) {
      const emptyCaption = document.createElement("div");
      emptyCaption.className = "note";
      emptyCaption.textContent = "No caption scores saved on this raw assessment.";
      captionSection.appendChild(emptyCaption);
    } else {
      captionKeys.forEach((key) => {
        const caption = captions[key] || {};
        const row = document.createElement("div");
        row.className = "panel stack";
        const title = document.createElement("strong");
        title.textContent = formatCaptionKeyLabel(key);
        const meta = document.createElement("div");
        meta.className = "note";
        meta.textContent = [
          `Score ${String(caption.gradeLetter || "").trim() || "N/A"}${String(caption.gradeModifier || "").trim() || ""}`,
        ].join(" • ");
        const comment = document.createElement("div");
        comment.className = "note";
        comment.textContent = String(caption.comment || "").trim() || "No comment.";
        row.appendChild(title);
        row.appendChild(meta);
        row.appendChild(comment);
        captionSection.appendChild(row);
      });
    }
    els.adminSubmissionDetail.appendChild(captionSection);

    const eventId = String(state.event.active?.id || selected.eventId || "").trim();
    const matchingRoster = resolveSubmissionTargetOptions(selected).filter(
      (entry) => !eventId || String(entry.eventId || state.event.active?.id || "").trim() === eventId
    );

    const ensembleSelect = document.createElement("select");
    if (!matchingRoster.length) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "No event ensembles loaded";
      placeholder.selected = true;
      ensembleSelect.appendChild(placeholder);
    }
    matchingRoster.forEach((entry) => {
      const option = document.createElement("option");
      option.value = `${entry.schoolId || ""}::${entry.ensembleId || ""}`;
      option.textContent = `${entry.schoolName || entry.schoolId || "School"} - ${
        normalizeEnsembleDisplayName({
          schoolName: entry.schoolName || entry.schoolId || "",
          ensembleName: entry.ensembleName,
          ensembleId: entry.ensembleId,
        }) || entry.ensembleId || "Ensemble"
      }`;
      if ((entry.ensembleId || "") === (selected.ensembleId || "")) {
        option.selected = true;
      }
      ensembleSelect.appendChild(option);
    });
    const positionSelect = document.createElement("select");
    ["stage1", "stage2", "stage3", "sight"].forEach((position) => {
      const option = document.createElement("option");
      option.value = position;
      option.textContent = position;
      if (position === selected.judgePosition) option.selected = true;
      positionSelect.appendChild(option);
    });
    const formTypeSelect = document.createElement("select");
    ["stage", "sight"].forEach((formType) => {
      const option = document.createElement("option");
      option.value = formType;
      option.textContent = formType;
      if (formType === selected.formType) option.selected = true;
      formTypeSelect.appendChild(option);
    });

    const controlWrap = document.createElement("div");
    controlWrap.className = "stack";
    const ensembleLabel = document.createElement("label");
    ensembleLabel.textContent = "Target Ensemble";
    ensembleLabel.appendChild(ensembleSelect);
    const positionLabel = document.createElement("label");
    positionLabel.textContent = "Judge Position";
    positionLabel.appendChild(positionSelect);
    const formLabel = document.createElement("label");
    formLabel.textContent = "Form Type";
    formLabel.appendChild(formTypeSelect);
    controlWrap.appendChild(ensembleLabel);
    controlWrap.appendChild(positionLabel);
    controlWrap.appendChild(formLabel);
    els.adminSubmissionDetail.appendChild(controlWrap);

    const actions = document.createElement("div");
    actions.className = "actions";
    const reassignBtn = document.createElement("button");
    reassignBtn.type = "button";
    reassignBtn.textContent = "Reassign";
    const officializeBtn = document.createElement("button");
    officializeBtn.type = "button";
    officializeBtn.textContent = "Officialize";
    const excludeBtn = document.createElement("button");
    excludeBtn.type = "button";
    excludeBtn.className = "ghost";
    excludeBtn.textContent = "Exclude";
    actions.appendChild(reassignBtn);
    actions.appendChild(officializeBtn);
    actions.appendChild(excludeBtn);
    els.adminSubmissionDetail.appendChild(actions);

    const status = document.createElement("div");
    status.className = "note";
    els.adminSubmissionDetail.appendChild(status);

    const getSelection = () => {
      const [schoolId = "", ensembleId = ""] = String(ensembleSelect.value || "").split("::");
      return {
        schoolId,
        ensembleId,
        eventId,
        judgePosition: positionSelect.value || selected.judgePosition || "",
        formType: formTypeSelect.value || selected.formType || "stage",
      };
    };

    reassignBtn.addEventListener("click", async () => {
      const next = getSelection();
      status.textContent = "Reassigning...";
      try {
        await reassignRawAssessment({
          rawAssessmentId: selected.id,
          ...next,
        });
        status.textContent = "Reassigned.";
      } catch (error) {
        status.textContent = error?.message || "Unable to reassign.";
      }
    });

    officializeBtn.addEventListener("click", async () => {
      const next = getSelection();
      status.textContent = "Officializing...";
      try {
        await officializeRawAssessment({
          rawAssessmentId: selected.id,
          ...next,
        });
        status.textContent = "Officialized.";
      } catch (error) {
        status.textContent = error?.message || "Unable to officialize.";
      }
    });

    excludeBtn.addEventListener("click", async () => {
      status.textContent = "Excluding...";
      try {
        await excludeRawAssessment({
          rawAssessmentId: selected.id,
          reason: "Excluded from live review queue.",
        });
        status.textContent = "Excluded.";
      } catch (error) {
        status.textContent = error?.message || "Unable to exclude.";
      }
    });
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
    title.textContent = "Printable Results Packet Files";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent =
      "Generate or load the exact-match stage form PDFs and audio files for results review and release.";
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
        openCombined.textContent = "Open Full Results Packet PDF";
        const printCombined = document.createElement("a");
        printCombined.className = "ghost";
        printCombined.href = assets.combined.url;
        printCombined.target = "_blank";
        printCombined.rel = "noopener";
        printCombined.textContent = "Print Full Results Packet PDF";
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
          unavailable.textContent = "No results packet files available for this judge yet.";
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
    title.textContent = "Printable Open Judge Sheet";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent =
      "Generate a printable PDF for this Open Judge sheet. Stage assessments use the exact-match stage form template.";
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

  function renderAdminSubmissionsWorkflowGuidance({
    hasActiveEvent = false,
    totalCount = 0,
    pendingCount = 0,
    officializedCount = 0,
    hasSelection = false,
  } = {}) {
    if (!els.adminSubmissionsWorkflowCard) return;
    let step = "Start";
    let nextTitle = "Set an active event to begin.";
    let nextHint = "Then review incoming assessments and officialize approved records.";
    let nextActionLabel = "Open Settings";
    let nextAction = () => {
      window.location.hash = "#admin/settings";
    };

    if (hasActiveEvent && totalCount === 0) {
      step = "Queue";
      nextTitle = "No assessments are waiting in the queue.";
      nextHint = "Use the judge workspace to submit a fresh assessment, then return here for review.";
      nextActionLabel = "Open Judge Workspace";
      nextAction = () => {
        window.location.hash = "#judge-open";
      };
    } else if (hasActiveEvent && pendingCount > 0 && !hasSelection) {
      step = "Queue";
      nextTitle = "Select an assessment to review.";
      nextHint = `${pendingCount}/${totalCount} assessments currently need review.`;
      nextActionLabel = "Open Review Queue";
      nextAction = () => {
        els.adminSubmissionsList?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } else if (hasActiveEvent && pendingCount > 0 && hasSelection) {
      step = "Review";
      nextTitle = "Review the selected assessment and fix association if needed.";
      nextHint = "Confirm ensemble, judge position, caption scoring, and audio before officializing.";
      nextActionLabel = "Open Assessment Detail";
      nextAction = () => {
        els.adminSubmissionDetail?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } else if (hasActiveEvent && totalCount > 0 && officializedCount < totalCount) {
      step = "Officialize";
      nextTitle = "Officialize approved assessments from the review queue.";
      nextHint = `${officializedCount}/${totalCount} assessments already officialized.`;
      nextActionLabel = "Open Review Queue";
      nextAction = () => {
        els.adminSubmissionsList?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } else if (hasActiveEvent && totalCount > 0 && officializedCount >= totalCount) {
      step = "Done";
      nextTitle = "All queued assessments are officialized.";
      nextHint = "Move to Packets & Results to manage release-ready results packets.";
      nextActionLabel = "Open Packets & Results";
      nextAction = () => {
        window.location.hash = "#admin/packets";
      };
    }

    if (els.adminSubmissionsCurrentStepPill) els.adminSubmissionsCurrentStepPill.textContent = step;
    if (els.adminSubmissionsNextStepTitle) els.adminSubmissionsNextStepTitle.textContent = nextTitle;
    if (els.adminSubmissionsNextStepHint) els.adminSubmissionsNextStepHint.textContent = nextHint;
    if (els.adminSubmissionsWorkflowActionBtn) {
      els.adminSubmissionsWorkflowActionBtn.textContent = nextActionLabel;
      els.adminSubmissionsWorkflowActionBtn.onclick = (event) => {
        event.preventDefault();
        nextAction?.();
      };
    }

    setAdminStepChip(els.adminSubmissionsStepChipEvent, {
      label: "Event",
      done: hasActiveEvent,
      active: !hasActiveEvent,
    });
    setAdminStepChip(els.adminSubmissionsStepChipQueue, {
      label: "Queue",
      done: hasActiveEvent && totalCount > 0,
      active: hasActiveEvent && totalCount > 0 && pendingCount > 0 && !hasSelection,
    });
    setAdminStepChip(els.adminSubmissionsStepChipReview, {
      label: "Review",
      done: hasActiveEvent && totalCount > 0 && pendingCount === 0,
      active: hasActiveEvent && pendingCount > 0 && hasSelection,
    });
    setAdminStepChip(els.adminSubmissionsStepChipOfficialize, {
      label: "Officialize",
      done: hasActiveEvent && totalCount > 0 && officializedCount >= totalCount,
      active: hasActiveEvent && totalCount > 0 && pendingCount === 0 && officializedCount < totalCount,
    });
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
    let nextHint = "Then select a school and review official results readiness before release.";
    let nextActionLabel = "Open Settings";
    let nextAction = () => {
      window.location.hash = "#admin/settings";
    };

    if (hasActiveEvent && !hasSchoolSelected) {
      step = "Select School";
      nextTitle = "Select a school to load official results packets.";
      nextHint = "Results packets are grouped by school to reduce noise and keep release review focused.";
      nextActionLabel = "Choose School";
      nextAction = () => {
        els.adminPacketsSchoolSelect?.focus();
      };
    } else if (hasActiveEvent && hasSchoolSelected && totalCount === 0) {
      step = "Review";
      nextTitle = "No official results packets found for this school.";
      nextHint = "Confirm schedules and officialized assessments, then return to results release.";
      nextActionLabel = "Open Live Submissions";
      nextAction = () => {
        window.location.hash = "#admin/submissions";
      };
    } else if (hasActiveEvent && hasSchoolSelected && releaseReadyCount < totalCount) {
      step = "Review";
      nextTitle = "Review incomplete results packets before release.";
      nextHint = `${releaseReadyCount}/${totalCount} results packets are ready to release.`;
      nextActionLabel = "Review Results";
      nextAction = () => {
        els.adminPacketsList?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } else if (hasActiveEvent && hasSchoolSelected && releasedCount < totalCount) {
      step = "Release";
      nextTitle = "Release ready results packets for the selected school.";
      nextHint = `${releasedCount}/${totalCount} results packets currently released.`;
      nextActionLabel = "Open Release Queue";
      nextAction = () => {
        els.adminPacketsList?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } else if (hasActiveEvent && hasSchoolSelected && totalCount > 0 && releasedCount >= totalCount) {
      step = "Done";
      nextTitle = "All results packets for this school are released.";
      nextHint = "Use View Results Packet to spot-check content or manage Open Judge sheets.";
      nextActionLabel = "Review Released Results";
      nextAction = () => {
        els.adminPacketsList?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    }

    if (els.adminPacketsCurrentStepPill) els.adminPacketsCurrentStepPill.textContent = step;
    if (els.adminPacketsNextStepTitle) els.adminPacketsNextStepTitle.textContent = nextTitle;
    if (els.adminPacketsNextStepHint) els.adminPacketsNextStepHint.textContent = nextHint;
    if (els.adminPacketsWorkflowActionBtn) {
      els.adminPacketsWorkflowActionBtn.textContent = nextActionLabel;
      els.adminPacketsWorkflowActionBtn.onclick = (event) => {
        event.preventDefault();
        nextAction?.();
      };
    }

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
      els.adminSchoolDetailTitle.textContent = `${schoolName} - Registrations`;
      els.adminSchoolDetailMeta.textContent = `Event: ${state.event.active?.name || "Active Event"} • Review ensemble readiness, scheduling, and director workspace state for this school.`;
      els.adminSchoolDetailHint.textContent = "Use this workspace to confirm scheduling, director workspace readiness, and director-entered data before results release.";
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

        const statusRow = document.createElement("div");
        statusRow.className = "row";
        const registeredBadge = document.createElement("span");
        registeredBadge.className = "badge";
        registeredBadge.textContent = "Registered";
        const scheduleBadge = document.createElement("span");
        scheduleBadge.className = "badge";
        scheduleBadge.textContent = performanceAt ? "Scheduled" : "Needs Schedule";
        const readyBadge = document.createElement("span");
        readyBadge.className = "badge";
        readyBadge.textContent =
          String(entryData?.status || "").trim().toLowerCase() === "ready" ? "Director Ready" : "Director In Progress";
        statusRow.appendChild(registeredBadge);
        statusRow.appendChild(scheduleBadge);
        statusRow.appendChild(readyBadge);
        li.appendChild(statusRow);

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

        const scheduleMeta = document.createElement("div");
        scheduleMeta.className = "note";
        scheduleMeta.textContent = performanceAt
          ? `Performance time set for ${formatStartTime(performanceAt)}.`
          : "No performance time assigned yet.";
        li.appendChild(scheduleMeta);

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
        cleanupTitle.textContent = "Results Packet Cleanup";
        cleanupRow.appendChild(cleanupTitle);
        const cleanupHint = document.createElement("p");
        cleanupHint.className = "hint";
        cleanupHint.textContent = "Delete all unreleased scheduled results packets and Open Judge sheets across the entire database.";
        cleanupRow.appendChild(cleanupHint);
        const cleanupBtn = document.createElement("button");
        cleanupBtn.type = "button";
        cleanupBtn.className = "ghost";
        cleanupBtn.textContent = "Delete All Unreleased Results Packets";
        cleanupBtn.addEventListener("click", async () => {
          const confirmed = confirmUser(
            "Delete all unreleased results packets across the entire database? Released packets will be skipped."
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
            const officialAssessmentCount = Number(preview.officialAssessmentCandidates || 0);
            if (!eventCount && !schoolCount && !packetCount && !submissionCount && !officialAssessmentCount) {
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
              `Scheduled assessment mirrors: ${submissionCount}\n` +
              `Official assessments: ${officialAssessmentCount}\n` +
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
              `Deleted scheduled assessment mirrors: ${result.deletedSubmissions || 0}\n` +
              `Deleted official assessments: ${result.deletedOfficialAssessments || 0}\n` +
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
              `Assessment mirrors updated: ${result.submissionsUpdated || 0}\n` +
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
              `Official assessments updated: ${result.submissionsUpdated || 0}\n` +
              `Results packet exports updated: ${result.exportsUpdated || 0}\n` +
              `Skipped (no sessions): ${result.skippedNoSessions || 0}\n` +
              `Skipped (no official assessment): ${result.skippedNoSubmission || 0}`
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
        els.adminPacketsHint.textContent = "Select a school to load official results review.";
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
        els.adminPacketsHint.textContent = "Loading results packet status for selected school...";
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
        const performLabel = formatPerformanceAt(entry.performanceAt) || String(entry.stageTime || "").trim();
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

        if (summary && !summary.requiredComplete) {
          const blockerNote = document.createElement("div");
          blockerNote.className = "note";
          const blockers = Array.isArray(summary.blockingPositions) ? summary.blockingPositions : [];
          blockerNote.textContent = blockers.length
            ? `Blocking positions: ${
              blockers.map((position) => JUDGE_POSITION_LABELS[position] || position).join(", ")
            }`
            : "Blocking positions: Results packet is incomplete.";
          li.appendChild(blockerNote);
        }

        const actions = document.createElement("div");
        actions.className = "row";
        const releaseBtn = document.createElement("button");
        releaseBtn.type = "button";
        const shouldRelease = !summary?.requiredReleased;
        releaseBtn.textContent = shouldRelease ? "Release Results Packet" : "Unrelease Results Packet";
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
            console.error("Update results release failed", error);
            alertUser(formatBlockerError(error, "Unable to update results release state."));
          } finally {
            releaseBtn.disabled = false;
          }
        });
        actions.appendChild(releaseBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ghost";
        deleteBtn.textContent = "Delete Results Packet";
        if (summary?.requiredReleased) {
          deleteBtn.disabled = true;
          deleteBtn.title = "Unrelease results packet first.";
        }
        deleteBtn.addEventListener("click", async () => {
          const ok = confirmUser(
            `Delete scheduled results packet for ${schoolName} - ${ensembleName}? This removes official assessments, supporting release records, and the packet export.`
          );
          if (!ok) return;
          deleteBtn.disabled = true;
          try {
            await deleteScheduledPacket({ eventId, ensembleId });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("Delete scheduled results packet failed", error);
            alertUser(error?.message || "Unable to delete scheduled results packet.");
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
        viewBtn.textContent = "View Results Packet";
        viewBtn.addEventListener("click", async () => {
          const isHidden = panel.classList.contains("is-hidden");
          if (isHidden) {
            panel.classList.remove("is-hidden");
            viewBtn.textContent = "Hide Results Packet";
            await loadAdminPacketView(entry, panel, eventId);
            renderAdminPacketAssetsSection({ eventId, ensembleId }, panel);
          } else {
            panel.classList.add("is-hidden");
            viewBtn.textContent = "View Results Packet";
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
          meta.textContent = `Judge: ${judgeLabel} - Judge Overall Rating: ${ratingLabel} - Updated: ${updatedLabel}`;
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
              topMeta.textContent = `Open Sheet ID: ${packet.id} - Updated: ${formatPacketTimestamp(packet.updatedAt) || "Recently updated"}`;
              detail.appendChild(topMeta);
              const summaryCard = renderAssessmentCard(
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
                  console.error("Open sheet lock/unlock failed", error);
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
                  console.error("Open sheet release/unrelease failed", error);
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
              console.error("Attach open sheet audio failed", error);
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
              `Delete Open Judge sheet for ${label}? This removes recorded audio and sessions.`
            );
            if (!ok) return;
            deleteBtn.disabled = true;
            try {
              await deleteOpenPacket({ packetId: packet.id });
              scheduleAdminPreflightRefresh?.({ immediate: true });
              await renderAdminPacketsBySchedule();
            } catch (error) {
              console.error("Delete open sheet failed", error);
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
        els.adminPacketsHint.textContent = "Unable to load results review right now.";
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
        button.setAttribute("aria-label", `Open registrations for ${schoolName}`);
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
        const summary = document.createElement("div");
        summary.className = "note";
        summary.textContent =
          scheduledCount === 0
            ? "No scheduled ensembles yet. Open to assign times and review director data."
            : `${scheduledCount} scheduled ensemble${scheduledCount === 1 ? "" : "s"} • ${readyCount} director-ready • open to manage registrations and check-in readiness.`;
        button.appendChild(summary);
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
    renderAdminLiveSubmissions,
    renderAdminPacketsBySchedule,
    renderRegisteredEnsemblesList,
  };
}
