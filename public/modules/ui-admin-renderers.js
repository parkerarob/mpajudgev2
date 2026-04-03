import { isTestArtifactText, hasExplicitTestArtifactFlag, isProductionRegistration, calculateInstrumentationStudentCount } from "./utils.js";
import {
  buildSlotModelFromFirestore,
  computeDaySlotTimes,
  serializeSlotModel,
  getScheduledEnsembleIds,
  countEnsembleSlots,
  validateSlotModel,
  dateToTimeStr,
  applyTimeToDate,
} from "./admin-scheduler-tools.js";

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
  CAPTION_TEMPLATES,
  normalizeEnsembleDisplayName,
  toDateOrNull,
  toLocalDatetimeValue,
  deriveAutoScheduleDayBreaks,
  mergeScheduleDayBreaks,
  formatPerformanceAt,
  getPacketData,
  officializeRawAssessment,
  excludeRawAssessment,
  deleteRawAssessment,
  reassignRawAssessment,
  fetchDirectorPacketAssets,
  generateOpenPacketPrintAsset,
  regenerateDirectorPacketExport,
  releasePacket,
  unreleasePacket,
  repairPacketReleaseState,
  repairReleasedPacketMetadata,
  setPacketCommentsOnly,
  deleteScheduledAssessment,
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
  repairPacketSubmissionLinkage,
  restoreCanonicalFromOpenPacket,
  recreateOpenPacketFromCanonical,
  deleteAllUnreleasedPackets,
  getPostEventCleanupCandidates,
  purgePostEventCleanupCandidate,
  purgePostEventCleanupCategory,
  cleanupTestArtifacts,
  renderAssessmentCard,
  loadAdminPacketView,
  confirmUser,
  alertUser,
  createScheduleEntry,
  deleteScheduleEntry,
  updateScheduleEntryTime,
  updateEntryFields,
  computeScheduleTimeline,
  formatAdminDayOfReadOnly,
  openDirectorDayOfFromAdmin,
  closeAdminSchoolDetail,
  applyAdminView,
  schedulePreEventGuidedFlowRender,
  scheduleAdminPreflightRefresh,
  refreshPreEventScheduleTimelineStarts,
  formatStartTime,
  saveSchedulerModel,
  deleteEntry,
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

  function isCommentsOnlySubmission(submission) {
    return Boolean(submission?.commentsOnly);
  }

  function getSubmissionRatingLabel(submission) {
    return isCommentsOnlySubmission(submission) ? "CO" : (submission?.computedFinalRatingLabel || "N/A");
  }

  function getSubmissionCaptionTotalLabel(submission) {
    return isCommentsOnlySubmission(submission) ? "CO" : (
      Number.isFinite(Number(submission?.captionScoreTotal)) ? String(Number(submission.captionScoreTotal)) : "N/A"
    );
  }
  let adminPacketsRenderQueued = false;
  let registeredRenderInFlight = false;
  let registeredRenderQueued = false;


  function formatBlockerError(error, fallbackMessage) {
    const blockers = Array.isArray(error?.details?.blockers) ? error.details.blockers : [];
    if (!blockers.length) return error?.message || fallbackMessage;
    const lines = blockers.map((blocker) => {
      const label =
        blocker.message ||
        blocker.label ||
        blocker.position ||
        blocker.code ||
        "Blocked";
      return `- ${label}`;
    });
    return `${fallbackMessage}\n${lines.join("\n")}`;
  }

  function openSourceSheetFromResultsView(packetId) {
    const resolvedPacketId = String(packetId || "").trim();
    if (!resolvedPacketId) return false;
    document.querySelectorAll("[data-attached-source-toggle]").forEach((button) => {
      if (String(button.dataset.expanded || "") === "true") return;
      button.click();
    });
    const selectorId = globalThis.CSS?.escape ? globalThis.CSS.escape(resolvedPacketId) : resolvedPacketId;
    const row = document.querySelector(`[data-source-packet-id="${selectorId}"]`);
    if (!row) return false;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    const viewButton = row.querySelector(`[data-source-packet-view-for="${selectorId}"]`);
    if (viewButton && /view source sheet/i.test(viewButton.textContent || "")) {
      viewButton.click();
    }
    return true;
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
    const s = String(value || "").trim().toLowerCase() || "draft";
    if (s === "submitted" || s === "locked" || s === "review_needed") return "Submitted";
    if (s === "reopened") return "Returned";
    if (s === "officialized") return "Verified";
    if (s === "released") return "Released";
    if (s === "excluded") return "Excluded";
    return "Draft";
  }

  function formatJudgeRatingLabel(value) {
    const label = String(value || "").trim();
    return label || "N/A";
  }

  function formatReleaseAuditStatus(summary) {
    if (summary?.hasPartialReleaseState) return "Partial Release";
    if (summary?.requiredReleased) return "Released";
    if (summary?.requiredComplete) return "Ready but not released";
    return "Blocked";
  }

  function formatReleaseAuditBlockers(summary) {
    if (summary?.hasPartialReleaseState) {
      return `Released early: ${(summary.releasedPositions || [])
        .map((position) => JUDGE_POSITION_LABELS[position] || position)
        .join(", ")}`;
    }
    const blockers = Array.isArray(summary?.blockingPositions) ? summary.blockingPositions : [];
    if (!blockers.length) {
      return summary?.requiredReleased || summary?.requiredComplete ? "None" : "Unknown";
    }
    return blockers.map((position) => JUDGE_POSITION_LABELS[position] || position).join(", ");
  }

  function renderAdminPacketsAuditTable({ entries = [], packetDataByEntryId = new Map(), eventId = "" } = {}) {
    if (!els.adminPacketsAuditBody || !els.adminPacketsAuditHint) return;
    els.adminPacketsAuditBody.innerHTML = "";
    if (!eventId) {
      els.adminPacketsAuditHint.textContent = "Set an active event to begin.";
      return;
    }
    if (!entries.length) {
      els.adminPacketsAuditHint.textContent = "No scheduled ensembles for the active event.";
      return;
    }
    let releasedCount = 0;
    entries.forEach((entry) => {
      const ensembleId = String(entry.ensembleId || "").trim();
      const schoolId = String(entry.schoolId || "").trim();
      const schoolName = entry.schoolName || getSchoolNameById(state.admin.schoolsList, schoolId) || "Unknown school";
      const ensembleName = normalizeEnsembleDisplayName({
        schoolName,
        ensembleName: entry.ensembleName || "",
        ensembleId,
      });
      const packetData = packetDataByEntryId.get(entry.id) || null;
      const summary = packetData?.summary || null;
      if (summary?.requiredReleased) releasedCount += 1;

      const row = document.createElement("tr");

      const nameCell = document.createElement("td");
      nameCell.textContent = `${schoolName} - ${ensembleName}`;
      row.appendChild(nameCell);

      const gradeCell = document.createElement("td");
      gradeCell.textContent = packetData?.grade || "—";
      row.appendChild(gradeCell);

      const overallCell = document.createElement("td");
      overallCell.textContent = summary?.overall?.label || "—";
      row.appendChild(overallCell);

      const releaseCell = document.createElement("td");
      releaseCell.textContent = formatReleaseAuditStatus(summary);
      row.appendChild(releaseCell);

      const blockerCell = document.createElement("td");
      blockerCell.textContent = formatReleaseAuditBlockers(summary);
      row.appendChild(blockerCell);

      const actionCell = document.createElement("td");
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "ghost";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", async () => {
        state.admin.packetsSchoolId = schoolId;
        if (els.adminPacketsSchoolSelect) {
          els.adminPacketsSchoolSelect.value = schoolId;
        }
        await renderAdminPacketsBySchedule();
      });
      actionCell.appendChild(openBtn);
      row.appendChild(actionCell);

      els.adminPacketsAuditBody.appendChild(row);
    });
    els.adminPacketsAuditHint.textContent = `Released to director: ${releasedCount} of ${entries.length}`;
  }

  function updateAdminPacketsAuditLoadButton({ loading = false, loaded = false, disabled = false } = {}) {
    if (!els.adminPacketsAuditLoadBtn) return;
    els.adminPacketsAuditLoadBtn.disabled = Boolean(disabled || loading);
    els.adminPacketsAuditLoadBtn.textContent = loading
      ? "Loading Release Audit..."
      : loaded
        ? "Refresh Release Audit"
        : "Load Release Audit";
  }

  function hasSubmissionTraceAudio(submission) {
    if (!submission || typeof submission !== "object") return false;
    return Boolean(String(submission.canonicalAudioUrl || submission.canonicalAudioPath || "").trim());
  }

  function describeSubmissionTrace(position, submission) {
    if (!submission) {
      return {
        label: JUDGE_POSITION_LABELS[position] || position,
        state: "Missing",
        detail: "No canonical sheet found for this required slot.",
      };
    }
    const issues = [];
    if (submission.status !== "released") {
      if (submission.status !== "submitted") issues.push(`status ${submission.status || "missing"}`);
      if (!submission.locked) issues.push("unlocked");
      if (!hasSubmissionTraceAudio(submission)) issues.push("stitched tape missing");
      const captionCount =
        submission.captions && typeof submission.captions === "object" ?
          Object.keys(submission.captions).length :
          0;
      if (captionCount < 7) issues.push(`captions ${captionCount}/7`);
      if (!submission.commentsOnly && !Number.isFinite(Number(submission.captionScoreTotal))) issues.push("no caption total");
      if (!submission.commentsOnly && !Number.isFinite(Number(submission.computedFinalRatingJudge))) issues.push("no rating");
    }
    const ratingLabel = submission.commentsOnly ? "CO" : formatJudgeRatingLabel(submission.computedFinalRatingLabel);
    const detailParts = [
      `Status: ${formatRawAssessmentStatus(submission.status || "")}`,
      `Locked: ${submission.locked ? "yes" : "no"}`,
      `Stitched Tape: ${hasSubmissionTraceAudio(submission) ? "yes" : "no"}`,
      `Rating: ${ratingLabel}`,
    ];
    if (issues.length) detailParts.push(`Issues: ${issues.join(", ")}`);
    const traceState =
      submission.status === "released" ?
        "Released" :
        issues.length ?
          "Blocked" :
          "Ready";
    return {
      label: JUDGE_POSITION_LABELS[position] || position,
      state: traceState,
      detail: detailParts.join(" - "),
    };
  }

  function getReleasedPositions(summary, submissions) {
    const requiredPositions = Array.isArray(summary?.requiredPositions) ? summary.requiredPositions : [];
    return requiredPositions.filter((position) => submissions?.[position]?.status === "released");
  }

  function augmentSummary(summary, submissions) {
    if (!summary || typeof summary !== "object") return summary;
    const releasedPositions = getReleasedPositions(summary, submissions);
    return {
      ...summary,
      releasedPositions,
      hasPartialReleaseState: releasedPositions.length > 0 && !summary.requiredReleased,
    };
  }

  async function renderPacketReleaseTrace({ eventId, ensembleId, packetData, wrapper }) {
    if (!wrapper) return;
    wrapper.innerHTML = "";
    const summary = augmentSummary(packetData?.summary || null, packetData?.submissions || {});
    const submissions = packetData?.submissions && typeof packetData.submissions === "object" ?
      packetData.submissions :
      {};

    const overview = document.createElement("div");
    overview.className = "note";
    if (summary?.hasPartialReleaseState) {
      overview.textContent = `Director Release: Invalid partial release state detected. Released early: ${summary.releasedPositions
        .map((position) => JUDGE_POSITION_LABELS[position] || position)
        .join(", ")}.`;
    } else if (summary?.requiredReleased) {
      overview.textContent = "Director Release: Released to director.";
    } else if (summary?.requiredComplete) {
      overview.textContent = "Director Release: Not released. Results Packet is complete but still withheld.";
    } else {
      overview.textContent = "Director Release: Not released. Results Packet is incomplete.";
    }
    wrapper.appendChild(overview);

    if (Array.isArray(summary?.blockingPositions) && summary.blockingPositions.length) {
      const blockers = document.createElement("div");
      blockers.className = "note";
      blockers.textContent = `Blocking positions: ${summary.blockingPositions
        .map((position) => JUDGE_POSITION_LABELS[position] || position)
        .join(", ")}`;
      wrapper.appendChild(blockers);
    }

    const slotList = document.createElement("div");
    slotList.className = "stack";
    const requiredPositions = Array.isArray(summary?.requiredPositions) ? summary.requiredPositions : [];
    requiredPositions.forEach((position) => {
      const item = describeSubmissionTrace(position, submissions[position]);
      const row = document.createElement("div");
      row.className = "note";
      row.textContent = `${item.label}: ${item.state}. ${item.detail}`;
      slotList.appendChild(row);
    });
    wrapper.appendChild(slotList);

    const exportWrap = document.createElement("div");
    exportWrap.className = "note";
    exportWrap.textContent = "Director packet export: checking...";
    wrapper.appendChild(exportWrap);

    try {
      const assets = await fetchDirectorPacketAssets({ eventId, ensembleId });
      if (!assets?.ok) {
        exportWrap.textContent = summary?.requiredReleased ?
          `Director packet export: unavailable. ${assets?.message || "Not found."}` :
          "Director packet export: not available yet because this packet is not released.";
        return;
      }
      if (assets.status === "ready") {
        exportWrap.textContent = "Director packet export: ready.";
        return;
      }
      if (assets.status === "failed") {
        exportWrap.textContent = `Director packet export: failed. ${assets.error || "Unknown error."}`;
        return;
      }
      exportWrap.textContent = `Director packet export: ${assets.status || "pending"}.`;
    } catch (error) {
      exportWrap.textContent = `Director packet export: unable to trace. ${error?.message || "Unknown error."}`;
    }
  }

  async function renderDirectorAccessTrace({ eventId, entry, packetData, wrapper }) {
    if (!wrapper || !entry) return;
    wrapper.innerHTML = "";

    const schoolId = String(entry.schoolId || "").trim();
    const ensembleId = String(entry.ensembleId || "").trim();
    const submissions = packetData?.submissions && typeof packetData.submissions === "object" ?
      packetData.submissions :
      {};

    const intro = document.createElement("div");
    intro.className = "note";
    intro.textContent = "Compare these school links. If they do not all point to the same school, the director can lose access to registration or released packets.";
    wrapper.appendChild(intro);

    const rows = [];
    rows.push({
      label: "Schedule Entry",
      schoolId: schoolId || "Missing",
      detail: `${entry.schoolName || "Unknown school"} - ${entry.ensembleName || ensembleId || "Unknown ensemble"}`,
    });

    rows.push({
      label: "Event Entry",
      schoolId: String(packetData?.entrySchoolId || schoolId || "Missing"),
      detail: `Grade: ${packetData?.grade || "Unknown"}`,
    });

    let schoolEnsembleStatus = "Unknown";
    try {
      const schoolEnsembleSnap =
        schoolId && ensembleId ?
          await getDocs(
            query(
              collection(db, COLLECTIONS.schools, schoolId, COLLECTIONS.ensembles),
              where("__name__", "==", ensembleId)
            )
          ) :
          null;
      schoolEnsembleStatus = schoolEnsembleSnap && !schoolEnsembleSnap.empty ?
        "Exists" :
        "Missing";
    } catch (error) {
      schoolEnsembleStatus = `Unable to load (${error?.message || "Unknown error"})`;
    }
    rows.push({
      label: "School Ensemble Roster Doc",
      schoolId: schoolId || "Missing",
      detail: `${schoolEnsembleStatus} for ensemble ${ensembleId || "Unknown"}`,
    });

    const canonicalSchoolIds = Array.from(new Set(
      Object.entries(submissions)
        .map(([position, submission]) => ({
          position,
          schoolId: String(submission?.schoolId || "").trim(),
        }))
        .filter((item) => item.schoolId)
        .map((item) => item.schoolId)
    ));
    rows.push({
      label: "Canonical Packet Slots",
      schoolId: canonicalSchoolIds.join(", ") || "Missing",
      detail: Object.entries(submissions)
        .map(([position, submission]) =>
          `${JUDGE_POSITION_LABELS[position] || position}: ${String(submission?.schoolId || "Missing")}`
        )
        .join(" | ") || "No canonical submissions loaded.",
    });

    let exportSchoolId = "Not found";
    let exportStatus = "No export record found.";
    try {
      const exportSnap = await getDocs(
        query(
          collection(db, COLLECTIONS.packetExports),
          where("eventId", "==", eventId),
          where("ensembleId", "==", ensembleId)
        )
      );
      if (!exportSnap.empty) {
        const exportData = exportSnap.docs[0].data() || {};
        exportSchoolId = String(exportData.schoolId || "").trim() || "Missing";
        exportStatus = `Status: ${String(exportData.status || "unknown")}`;
      }
    } catch (error) {
      exportStatus = `Unable to load export record: ${error?.message || "Unknown error"}`;
    }
    rows.push({
      label: "Packet Export",
      schoolId: exportSchoolId,
      detail: exportStatus,
    });

    let directorDetail = "No director users found for this school.";
    try {
      const directorsSnap = schoolId ?
        await getDocs(
          query(
            collection(db, COLLECTIONS.users),
            where("schoolId", "==", schoolId)
          )
        ) :
        { docs: [] };
      const directors = directorsSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((user) => user.role === "director" || user?.roles?.director === true);
      if (directors.length) {
        directorDetail = directors
          .map((user) => `${user.displayName || user.name || user.email || user.id} (${user.email || user.id})`)
          .join(" | ");
      }
    } catch (error) {
      directorDetail = `Unable to load director assignment: ${error?.message || "Unknown error"}`;
    }
    rows.push({
      label: "Assigned Director Users",
      schoolId: schoolId || "Missing",
      detail: directorDetail,
    });

    rows.forEach((item) => {
      const row = document.createElement("div");
      row.className = "note";
      row.textContent = `${item.label}: ${item.schoolId}. ${item.detail}`;
      wrapper.appendChild(row);
    });
  }

  function formatCaptionKeyLabel(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim() || "Caption";
  }

  function getAssessmentAudioSegments(item) {
    if (!Array.isArray(item?.audioSegments)) return [];
    return item.audioSegments
      .map((segment) => {
        const audioUrl = String(segment?.audioUrl || "").trim();
        const audioPath = String(segment?.audioPath || "").trim();
        if (!audioUrl && !audioPath) return null;
        return {
          audioUrl,
          audioPath,
          durationSec: Number(segment?.durationSec || 0),
        };
      })
      .filter(Boolean);
  }

  function appendAssessmentAudio(container, item) {
    if (!container || !item) return;
    const canonicalAudioUrl = String(
      item.canonicalAudioUrl || item.stitchedAudioUrl || item.audioUrl || ""
    ).trim();
    const audioSegments = getAssessmentAudioSegments(item);
    const supplementalAudioUrl = String(
      item.supplementalAudioUrl || item.supplementalLatestAudioUrl || ""
    ).trim();

    if (canonicalAudioUrl) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.className = "audio";
      audio.src = canonicalAudioUrl;
      container.appendChild(audio);
    } else if (audioSegments.length === 1 && audioSegments[0]?.audioUrl) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.className = "audio";
      audio.src = audioSegments[0].audioUrl;
      container.appendChild(audio);
    } else if (audioSegments.length > 1) {
      const partsLabel = document.createElement("div");
      partsLabel.className = "note";
      partsLabel.textContent = `Tape Segments: ${audioSegments.length}`;
      container.appendChild(partsLabel);
      audioSegments.forEach((segment, index) => {
        if (!segment.audioUrl) return;
        const label = document.createElement("div");
        label.className = "note";
        label.textContent = `Part ${index + 1}`;
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.className = "audio";
        audio.src = segment.audioUrl;
        container.appendChild(label);
        container.appendChild(audio);
      });
    }

    if (supplementalAudioUrl) {
      const supplementalLabel = document.createElement("div");
      supplementalLabel.className = "note";
      supplementalLabel.textContent = "Supplemental Audio";
      const supplementalAudio = document.createElement("audio");
      supplementalAudio.controls = true;
      supplementalAudio.preload = "metadata";
      supplementalAudio.className = "audio";
      supplementalAudio.src = supplementalAudioUrl;
      container.appendChild(supplementalLabel);
      container.appendChild(supplementalAudio);
    }
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
    if (els.adminSubmissionsFilter && els.adminSubmissionsFilter.value !== (state.admin.rawAssessmentFilter || "pending")) {
      els.adminSubmissionsFilter.value = state.admin.rawAssessmentFilter || "pending";
    }
    if (els.adminSubmissionsHint) {
      els.adminSubmissionsHint.textContent = items.length
        ? `${items.length} source sheet${items.length === 1 ? "" : "s"} in queue.`
        : "";
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
        ? "Select a source sheet to review."
        : state.event.active?.id
          ? "No source sheets are waiting in this queue."
          : "Set an active event to begin reviewing source sheets.";
      empty.appendChild(emptyNote);
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

    appendAssessmentAudio(els.adminSubmissionDetail, selected);

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
      `Judge Overall Rating ${selected.commentsOnly ? "CO" : formatJudgeRatingLabel(selected.computedFinalRatingLabel)}`,
      selected.commentsOnly ?
        "Caption Total CO" :
        (Number.isFinite(Number(selected.captionScoreTotal))
          ? `Caption Total ${Number(selected.captionScoreTotal)}`
          : "Caption Total N/A"),
    ].join(" • ");
    els.adminSubmissionDetail.appendChild(scoringMeta);

    const captions = selected.captions && typeof selected.captions === "object"
      ? selected.captions
      : {};
    const formType = String(selected.formType || "stage").trim() || "stage";
    const template = CAPTION_TEMPLATES?.[formType] || CAPTION_TEMPLATES?.stage || [];
    const orderedKeys = template.map(({ key }) => key);
    const extraKeys = Object.keys(captions).filter((key) => !orderedKeys.includes(key));
    const captionKeys = [...orderedKeys.filter((key) => key in captions), ...extraKeys];
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
    officializeBtn.textContent = "Add to Results Packet";
    const excludeBtn = document.createElement("button");
    excludeBtn.type = "button";
    excludeBtn.className = "ghost";
    excludeBtn.textContent = "Exclude";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    actions.appendChild(reassignBtn);
    actions.appendChild(officializeBtn);
    actions.appendChild(excludeBtn);
    actions.appendChild(deleteBtn);
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

    const isOfficialized = String(selected.status || "").trim() === "officialized";
    deleteBtn.disabled = isOfficialized;
    if (isOfficialized) {
      deleteBtn.title = "Approved submissions cannot be deleted from the review queue.";
    } else {
      deleteBtn.title = "";
    }
    reassignBtn.disabled = isOfficialized;
    officializeBtn.disabled = isOfficialized;
    if (isOfficialized) {
      reassignBtn.title = "Approved submissions must be managed from Packets & Results.";
      officializeBtn.title = "This submission is already approved into a packet slot.";
    } else {
      reassignBtn.title = "";
      officializeBtn.title = "";
    }

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
      status.textContent = "Adding to Results Packet...";
      try {
        await officializeRawAssessment({
          rawAssessmentId: selected.id,
          ...next,
        });
        status.textContent = "Added to Results Packet.";
      } catch (error) {
        status.textContent = error?.message || "Unable to add to Results Packet.";
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

    deleteBtn.addEventListener("click", async () => {
      if (deleteBtn.disabled) return;
      const confirmed = window.confirm(
        "Delete this non-official assessment and its source sheet? This cannot be undone."
      );
      if (!confirmed) return;
      status.textContent = "Deleting...";
      try {
        await deleteRawAssessment({
          rawAssessmentId: selected.id,
        });
        state.admin.selectedRawAssessmentId = "";
        status.textContent = "Deleted.";
      } catch (error) {
        status.textContent = error?.message || "Unable to delete.";
      }
    });
  }

  async function renderAdminRatingsView() {
    if (!els.adminRatingsTableBody || !els.adminRatingsHint) return;
    const renderToken = (state.admin.ratingsRenderToken || 0) + 1;
    state.admin.ratingsRenderToken = renderToken;
    const eventId = String(state.event.active?.id || "").trim();
    const ratingsHeaderEls = {
      stage1: els.adminRatingsStage1Judge,
      stage2: els.adminRatingsStage2Judge,
      stage3: els.adminRatingsStage3Judge,
      sight: els.adminRatingsSightJudge,
    };
    const resetRatingsHeaders = () => {
      Object.values(ratingsHeaderEls).forEach((node) => {
        if (node) node.textContent = "";
      });
    };
    if (!eventId) {
      els.adminRatingsHint.textContent = "Set an active event to load ratings.";
      els.adminRatingsTableBody.innerHTML = "";
      resetRatingsHeaders();
      return;
    }

    els.adminRatingsHint.textContent = "Loading ratings summary...";
    els.adminRatingsTableBody.innerHTML = "";
    resetRatingsHeaders();

    try {
      const extractJudgeLastName = (value) => {
        const parts = String(value || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        return parts.length ? parts[parts.length - 1] : "";
      };
      const buildSlotCell = (submission) => {
        const cell = document.createElement("td");
        cell.className = "admin-ratings-slot";
        cell.textContent = submission ? getSubmissionRatingLabel(submission) : "—";
        return cell;
      };
      const scheduleEntries = await fetchScheduleEntries(eventId).catch(() => []);
      const ordered = (Array.isArray(scheduleEntries) ? scheduleEntries : [])
        .slice()
        .sort((a, b) => {
          const aTime = toDateOrNull(a.performanceAt)?.getTime() || 0;
          const bTime = toDateOrNull(b.performanceAt)?.getTime() || 0;
          if (aTime !== bTime) return aTime - bTime;
          const orderA = Number(a.orderIndex);
          const orderB = Number(b.orderIndex);
          if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) return orderA - orderB;
          const schoolCompare = String(a.schoolName || a.schoolId || "").localeCompare(
            String(b.schoolName || b.schoolId || "")
          );
          if (schoolCompare) return schoolCompare;
          return String(a.ensembleName || a.ensembleId || "").localeCompare(
            String(b.ensembleName || b.ensembleId || "")
          );
        });
      const uniqueOrdered = [];
      const seenEnsembles = new Set();
      ordered.forEach((entry) => {
        const schoolId = String(entry?.schoolId || "").trim();
        const ensembleId = String(entry?.ensembleId || "").trim();
        const key = `${schoolId}::${ensembleId}`;
        if (!schoolId || !ensembleId || seenEnsembles.has(key)) return;
        seenEnsembles.add(key);
        uniqueOrdered.push(entry);
      });

      if (!uniqueOrdered.length) {
        els.adminRatingsHint.textContent = "No scheduled ensembles found for the active event.";
        return;
      }

      const packetPayloads = await Promise.all(
        uniqueOrdered.map(async (entry) => ({
          entry,
          packetData: await getPacketData({ eventId, entry }).catch(() => null),
        }))
      );
      if (state.admin.ratingsRenderToken !== renderToken) return;

      const positionOrder = ["stage1", "stage2", "stage3", "sight"];
      positionOrder.forEach((position) => {
        const match = packetPayloads.find(({ packetData }) => packetData?.submissions?.[position]?.judgeName);
        const judgeLastName = extractJudgeLastName(match?.packetData?.submissions?.[position]?.judgeName || "");
        if (ratingsHeaderEls[position]) ratingsHeaderEls[position].textContent = judgeLastName;
      });

      packetPayloads.forEach(({ entry, packetData }) => {
        const row = document.createElement("tr");
        const labelCell = document.createElement("td");
        labelCell.className = "admin-ratings-ensemble";
        labelCell.innerHTML = `<strong>${entry.schoolName || getSchoolNameById(state.admin.schoolsList, entry.schoolId) || entry.schoolId || "School"}</strong><br>${normalizeEnsembleDisplayName({
          schoolName: entry.schoolName || getSchoolNameById(state.admin.schoolsList, entry.schoolId) || "",
          ensembleName: entry.ensembleName,
          ensembleId: entry.ensembleId,
        }) || entry.ensembleId || "Ensemble"}`;
        row.appendChild(labelCell);

        const gradeCell = document.createElement("td");
        gradeCell.className = "admin-ratings-grade admin-ratings-divider";
        gradeCell.textContent = packetData?.grade || "—";
        row.appendChild(gradeCell);

        const submissions = packetData?.submissions || {};
        [
          "stage1",
          "stage2",
          "stage3",
          "sight",
        ].forEach((position) => {
          const submission = submissions[position] || null;
          row.appendChild(buildSlotCell(submission));
        });

        const overallCell = document.createElement("td");
        overallCell.className = "admin-ratings-overall admin-ratings-divider-left";
        overallCell.textContent = packetData?.summary?.overall?.label || "—";
        row.appendChild(overallCell);
        els.adminRatingsTableBody.appendChild(row);
      });

      els.adminRatingsHint.textContent =
        `${packetPayloads.length} ensemble${packetPayloads.length === 1 ? "" : "s"} loaded for the active event.`;
    } catch (error) {
      console.error("Failed to render admin ratings view", error);
      els.adminRatingsHint.textContent = error?.message || "Unable to load ratings summary right now.";
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

  function formatCleanupDispositionLabel(disposition = "") {
    const normalized = String(disposition || "").trim().toLowerCase();
    if (normalized === "reviewable") return "Reviewable";
    if (normalized === "protected") return "Protected";
    return "Blocked";
  }

  function formatCleanupCountLabel(count = 0, noun = "item") {
    const value = Number(count || 0);
    return `${value} ${noun}${value === 1 ? "" : "s"}`;
  }

  async function appendPostEventCleanupPanel({ eventId = "", container = null } = {}) {
    if (!container || !eventId) return;
    const cleanupRow = document.createElement("div");
    cleanupRow.className = "panel stack";
    const title = document.createElement("h4");
    title.textContent = "Post-Event Cleanup";
    cleanupRow.appendChild(title);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Review stale unreleased event data. Anything with released director-visible history is protected and cannot be purged here.";
    cleanupRow.appendChild(hint);
    const status = document.createElement("div");
    status.className = "note";
    status.textContent = "Loading cleanup candidates...";
    cleanupRow.appendChild(status);
    const actions = document.createElement("div");
    actions.className = "row";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "ghost";
    refreshBtn.textContent = "Refresh Cleanup";
    actions.appendChild(refreshBtn);
    cleanupRow.appendChild(actions);
    const categoriesWrap = document.createElement("div");
    categoriesWrap.className = "stack";
    cleanupRow.appendChild(categoriesWrap);
    container.appendChild(cleanupRow);

    const loadCandidates = async () => {
      refreshBtn.disabled = true;
      categoriesWrap.innerHTML = "";
      status.textContent = "Loading cleanup candidates...";
      try {
        const result = await getPostEventCleanupCandidates({ eventId });
        const categories = Array.isArray(result.categories) ? result.categories : [];
        const counts = result.counts || {};
        status.textContent = categories.length
          ? [
            formatCleanupCountLabel(counts.reviewable || 0, "reviewable item"),
            formatCleanupCountLabel(counts.blocked || 0, "blocked item"),
            formatCleanupCountLabel(counts.protected || 0, "protected item"),
          ].join(" • ")
          : "No stale cleanup candidates were found for the active event.";
        if (!categories.length) return;
        for (const category of categories) {
          const details = document.createElement("details");
          details.className = "panel";
          if ((category.counts?.reviewable || 0) > 0) details.open = true;
          const summary = document.createElement("summary");
          summary.className = "row row--between row--center";
          const summaryTitle = document.createElement("strong");
          summaryTitle.textContent = category.label || category.category || "Cleanup";
          const summaryMeta = document.createElement("span");
          summaryMeta.className = "note";
          summaryMeta.textContent = [
            formatCleanupCountLabel(category.counts?.reviewable || 0, "reviewable"),
            formatCleanupCountLabel(category.counts?.blocked || 0, "blocked"),
            formatCleanupCountLabel(category.counts?.protected || 0, "protected"),
          ].join(" • ");
          summary.appendChild(summaryTitle);
          summary.appendChild(summaryMeta);
          details.appendChild(summary);

          const categoryActions = document.createElement("div");
          categoryActions.className = "row";
          if ((category.counts?.reviewable || 0) > 0) {
            const bulkBtn = document.createElement("button");
            bulkBtn.type = "button";
            bulkBtn.className = "ghost";
            bulkBtn.textContent = `Purge Reviewable ${category.label || "Items"}`;
            bulkBtn.addEventListener("click", async () => {
              const ok = confirmUser(
                `Purge all reviewable items in ${category.label || "this category"}?\n\nReleased history stays protected. Blocked items will be skipped.`
              );
              if (!ok) return;
              bulkBtn.disabled = true;
              status.textContent = `Purging ${category.label || "cleanup category"}...`;
              try {
                const bulkResult = await purgePostEventCleanupCategory({
                  eventId,
                  category: category.category,
                });
                scheduleAdminPreflightRefresh?.({ immediate: true });
                await renderAdminPacketsBySchedule();
                alertUser(
                  `${category.label || "Cleanup"} purge complete.\n` +
                  `Purged: ${bulkResult.purgedCount || 0}`
                );
              } catch (error) {
                console.error("purgePostEventCleanupCategory failed", error);
                status.textContent = error?.message || "Unable to purge cleanup category.";
              } finally {
                bulkBtn.disabled = false;
              }
            });
            categoryActions.appendChild(bulkBtn);
          }
          details.appendChild(categoryActions);

          const list = document.createElement("div");
          list.className = "stack";
          const items = Array.isArray(category.items) ? category.items : [];
          items.forEach((item) => {
            const card = document.createElement("div");
            card.className = "panel stack";
            const header = document.createElement("div");
            header.className = "row row--between row--center";
            const label = document.createElement("strong");
            label.textContent = item.label || item.id || "Cleanup item";
            const disposition = document.createElement("span");
            disposition.className = "badge";
            disposition.textContent = formatCleanupDispositionLabel(item.disposition);
            header.appendChild(label);
            header.appendChild(disposition);
            card.appendChild(header);
            const detail = document.createElement("div");
            detail.className = "note";
            detail.textContent = [
              item.reason || "",
              item.detail || "",
            ].filter(Boolean).join(" • ");
            card.appendChild(detail);
            if (item.disposition !== "reviewable") {
              const locked = document.createElement("div");
              locked.className = "note";
              locked.textContent =
                item.disposition === "protected" ?
                  "Protected items are shown for review only." :
                  "Blocked items require repair or a different cleanup path first.";
              card.appendChild(locked);
            } else {
              const purgeBtn = document.createElement("button");
              purgeBtn.type = "button";
              purgeBtn.className = "ghost danger";
              purgeBtn.textContent = "Purge Item";
              purgeBtn.addEventListener("click", async () => {
                const ok = confirmUser(
                  `Purge ${item.label || item.id}?\n\nThis only removes stale unreleased data for this item and cannot be undone.`
                );
                if (!ok) return;
                purgeBtn.disabled = true;
                status.textContent = `Purging ${item.label || item.id}...`;
                try {
                  await purgePostEventCleanupCandidate({
                    eventId,
                    candidateType: item.candidateType,
                    candidateId: item.id,
                  });
                  scheduleAdminPreflightRefresh?.({ immediate: true });
                  await renderAdminPacketsBySchedule();
                } catch (error) {
                  console.error("purgePostEventCleanupCandidate failed", error);
                  status.textContent = error?.message || "Unable to purge cleanup item.";
                } finally {
                  purgeBtn.disabled = false;
                }
              });
              card.appendChild(purgeBtn);
            }
            list.appendChild(card);
          });
          details.appendChild(list);
          categoriesWrap.appendChild(details);
        }
      } catch (error) {
        console.error("getPostEventCleanupCandidates failed", error);
        status.textContent = error?.message || "Unable to load post-event cleanup candidates.";
      } finally {
        refreshBtn.disabled = false;
      }
    };

    refreshBtn.addEventListener("click", () => {
      void loadCandidates();
    });
    await loadCandidates();
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
      commentsOnly: Boolean(packet.commentsOnly),
      captionScoreTotal: Number.isFinite(Number(packet.captionScoreTotal))
        ? Number(packet.captionScoreTotal)
        : null,
      computedFinalRatingLabel: packet.computedFinalRatingLabel || "N/A",
    };
  }

  function buildAdminEntryEditPanel({
    entryData,
    eventId,
    schoolId,
    ensembleId,
    ensembleName,
    readOnlyElement,
  }) {
    const data = entryData || {};
    const instrumentation = data.instrumentation || {};
    const seating = data.seating || {};
    const percussionNeeds = data.percussionNeeds || {};
    const lunchOrder = data.lunchOrder || {};
    const details = document.createElement("details");
    details.className = "admin-entry-edit-details";
    const summary = document.createElement("summary");
    summary.textContent = "Edit event form data";
    details.appendChild(summary);

    const form = document.createElement("div");
    form.className = "admin-entry-edit-form";
    const info = document.createElement("div");
    info.className = "hint";
    info.textContent = "Update instrumentation, seating, percussion, and pizza order details for this ensemble.";
    form.appendChild(info);

    const instrumentationLabel = document.createElement("label");
    instrumentationLabel.textContent = "Instrumentation notes";
    const instrumentationInput = document.createElement("textarea");
    instrumentationInput.rows = 3;
    instrumentationInput.value = String(instrumentation.otherInstrumentationNotes || "");
    instrumentationLabel.appendChild(instrumentationInput);
    form.appendChild(instrumentationLabel);

    const seatingLabel = document.createElement("label");
    seatingLabel.textContent = "Seating notes";
    const seatingInput = document.createElement("textarea");
    seatingInput.rows = 3;
    seatingInput.value = String(seating.notes || "");
    seatingLabel.appendChild(seatingInput);
    form.appendChild(seatingLabel);

    const percussionLabel = document.createElement("label");
    percussionLabel.textContent = "Percussion notes";
    const percussionInput = document.createElement("textarea");
    percussionInput.rows = 3;
    percussionInput.value = String(percussionNeeds.notes || "");
    percussionLabel.appendChild(percussionInput);
    form.appendChild(percussionLabel);

    const lunchRow = document.createElement("div");
    lunchRow.className = "row";
    const pepperoniLabel = document.createElement("label");
    pepperoniLabel.textContent = "Pepperoni qty";
    const pepperoniInput = document.createElement("input");
    pepperoniInput.type = "number";
    pepperoniInput.min = "0";
    pepperoniInput.step = "1";
    pepperoniInput.value = String(Number(lunchOrder.pepperoniQty || 0));
    pepperoniLabel.appendChild(pepperoniInput);
    const cheeseLabel = document.createElement("label");
    cheeseLabel.textContent = "Cheese qty";
    const cheeseInput = document.createElement("input");
    cheeseInput.type = "number";
    cheeseInput.min = "0";
    cheeseInput.step = "1";
    cheeseInput.value = String(Number(lunchOrder.cheeseQty || 0));
    cheeseLabel.appendChild(cheeseInput);
    lunchRow.appendChild(pepperoniLabel);
    lunchRow.appendChild(cheeseLabel);
    form.appendChild(lunchRow);

    const pickupLabel = document.createElement("label");
    pickupLabel.textContent = "Pizza pickup timing";
    const pickupSelect = document.createElement("select");
    [
      { value: "", label: "Select timing" },
      { value: "before", label: "Before performance" },
      { value: "after", label: "After performance" },
    ].forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      pickupSelect.appendChild(option);
    });
    pickupSelect.value = String(lunchOrder.pickupTiming || "");
    pickupLabel.appendChild(pickupSelect);
    form.appendChild(pickupLabel);

    const statusMessage = document.createElement("div");
    statusMessage.className = "hint";
    statusMessage.textContent = "";
    form.appendChild(statusMessage);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ghost";
    saveBtn.textContent = "Save event form updates";
    const sanitizeCount = (value) => {
      const parsed = Math.round(Number(value));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    };
    saveBtn.addEventListener("click", async () => {
      const instrumentationPayload = {
        ...instrumentation,
        otherInstrumentationNotes: instrumentationInput.value.trim(),
      };
      const seatingPayload = {
        ...seating,
        notes: seatingInput.value.trim(),
      };
      const percussionPayload = {
        ...percussionNeeds,
        notes: percussionInput.value.trim(),
      };
      const lunchPayload = {
        ...lunchOrder,
        pepperoniQty: sanitizeCount(pepperoniInput.value),
        cheeseQty: sanitizeCount(cheeseInput.value),
        pickupTiming: pickupSelect.value || "",
      };
      const payload = {
        eventId,
        schoolId,
        ensembleId,
        instrumentation: instrumentationPayload,
        seating: seatingPayload,
        percussionNeeds: percussionPayload,
        lunchOrder: lunchPayload,
      };
      statusMessage.textContent = "Saving...";
      saveBtn.disabled = true;
      try {
        await updateEntryFields(eventId, ensembleId, payload);
        entryData.instrumentation = instrumentationPayload;
        entryData.seating = seatingPayload;
        entryData.percussionNeeds = percussionPayload;
        entryData.lunchOrder = lunchPayload;
        readOnlyElement.textContent = formatAdminDayOfReadOnly(entryData);
        statusMessage.textContent = `Saved ${new Date().toLocaleTimeString()}.`;
      } catch (error) {
        console.error("Admin entry save failed", error);
        alertUser(`Unable to save event form data for ${ensembleName || ensembleId}.`);
        statusMessage.textContent = "Save failed.";
      } finally {
        saveBtn.disabled = false;
      }
    });
    form.appendChild(saveBtn);

    details.appendChild(form);
    return details;
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
        state.admin.currentView !== "eventPrep" ||
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
        const storedEntryData = entryDataByEnsemble.get(ensembleId);
        const entryData = storedEntryData || {};
        if (!storedEntryData) {
          entryDataByEnsemble.set(ensembleId, entryData);
        }

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
        const editPanel = buildAdminEntryEditPanel({
          entryData,
          eventId,
          schoolId,
          ensembleId,
          ensembleName,
          readOnlyElement: readOnly,
        });
        li.appendChild(editPanel);

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
        if (els.adminPacketsAuditBody) els.adminPacketsAuditBody.innerHTML = "";
        if (els.adminPacketsAuditHint) els.adminPacketsAuditHint.textContent = "Set an active event to begin.";
        updateAdminPacketsAuditLoadButton({ loaded: false, disabled: true });
        return;
      }
      updateAdminPacketsAuditLoadButton({
        loaded: Boolean(state.admin.packetsAuditLoaded),
        disabled: false,
      });
      els.adminPacketsHint.textContent = "Loading scheduled ensembles...";
      els.adminPacketsList.innerHTML = "";
      const appendBulkCleanupPanel = () => {
        const maintenanceBody = document.querySelector(".admin-maintenance-body");
        if (!maintenanceBody) return;
        maintenanceBody.innerHTML = "";
        const cleanupHint = document.createElement("p");
        cleanupHint.className = "hint";
        cleanupHint.textContent =
          "Release-safe maintenance tools only. Destructive cleanup actions are disabled on this branch.";
        maintenanceBody.appendChild(cleanupHint);
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
        maintenanceBody.appendChild(repairBtn);
        const repairOpenTapeBtn = document.createElement("button");
        repairOpenTapeBtn.type = "button";
        repairOpenTapeBtn.className = "ghost";
        repairOpenTapeBtn.textContent = "Restitch Packet Tape";
        repairOpenTapeBtn.addEventListener("click", async () => {
          const runDry = window.confirm(
            "Run a DRY RUN first?\nOK = Dry run only (safe preview)\nCancel = Apply fixes now"
          );
          repairOpenTapeBtn.disabled = true;
          try {
            const result = await repairOpenSubmissionAudioMetadata({
              dryRun: runDry,
              eventId,
              schoolId: state.admin.packetsSchoolId || "",
            });
            await renderAdminPacketsBySchedule();
            alertUser(
              `${runDry ? "Dry run complete" : "Packet tape restitch complete"}.\n` +
              `Scope: selected school\n` +
              `Open packets updated: ${result.packetsUpdated || 0}\n` +
              `Submission docs updated: ${result.submissionsUpdated || 0}\n` +
              `Official assessments updated: ${result.officialAssessmentsUpdated || 0}\n` +
              `Results packet exports updated: ${result.exportsUpdated || 0}\n` +
              `Skipped (no sessions): ${result.skippedNoSessions || 0}\n` +
              `Skipped (no canonical slot or stitched tape): ${result.skippedNoSubmission || 0}`
            );
          } catch (error) {
            console.error("repairOpenSubmissionAudioMetadata failed", error);
            alertUser(error?.message || "Unable to restitch packet tape.");
          } finally {
            repairOpenTapeBtn.disabled = false;
          }
        });
        maintenanceBody.appendChild(repairOpenTapeBtn);
        const repairLinkageBtn = document.createElement("button");
        repairLinkageBtn.type = "button";
        repairLinkageBtn.className = "ghost";
        repairLinkageBtn.textContent = "Repair Packet Linkage";
        repairLinkageBtn.addEventListener("click", async () => {
          const runDry = window.confirm(
            "Run a DRY RUN first?\nOK = Dry run only (safe preview)\nCancel = Apply fixes now"
          );
          repairLinkageBtn.disabled = true;
          try {
            const result = await repairPacketSubmissionLinkage({ dryRun: runDry });
            await renderAdminPacketsBySchedule();
            alertUser(
              `${runDry ? "Dry run complete" : "Packet linkage repair complete"}.\n` +
              `Packets updated: ${result.packetsUpdated || 0}\n` +
              `Raw assessments updated: ${result.rawAssessmentsUpdated || 0}\n` +
              `Submission docs cloned: ${result.submissionsCloned || 0}\n` +
              `Official assessment docs cloned: ${result.officialAssessmentsCloned || 0}\n` +
              `Raw official pointers updated: ${result.officialAssessmentPointersUpdated || 0}\n` +
              `Skipped already correct: ${result.skippedAlreadyCorrect || 0}\n` +
              `Skipped incomplete: ${result.skippedIncomplete || 0}`
            );
          } catch (error) {
            console.error("repairPacketSubmissionLinkage failed", error);
            alertUser(error?.message || "Unable to repair packet linkage.");
          } finally {
            repairLinkageBtn.disabled = false;
          }
        });
        maintenanceBody.appendChild(repairLinkageBtn);
        const restorePacketBtn = document.createElement("button");
        restorePacketBtn.type = "button";
        restorePacketBtn.className = "ghost";
        restorePacketBtn.textContent = "Restore Results Packet From Source Sheet";
        restorePacketBtn.addEventListener("click", async () => {
          const packetId = String(
            window.prompt("Enter the Source Sheet ID to restore from:", "") || ""
          ).trim();
          if (!packetId) return;
          const runDry = window.confirm(
            "Run a DRY RUN first?\nOK = Dry run only (safe preview)\nCancel = Apply restore now"
          );
          restorePacketBtn.disabled = true;
          try {
            const result = await restoreCanonicalFromOpenPacket({ packetId, dryRun: runDry });
            await renderAdminPacketsBySchedule();
            alertUser(
              `${runDry ? "Dry run complete" : "Results Packet restore complete"}.\n` +
              `Source Sheet ID: ${result.packetId || packetId}\n` +
              `Results Packet Slot: ${result.submissionId || "Unknown"}\n` +
              `Judge Slot: ${result.judgePosition || "Unknown"}\n` +
              `Judge: ${result.packetJudgeName || "Unknown"}`
            );
          } catch (error) {
            console.error("restoreCanonicalFromOpenPacket failed", error);
            alertUser(error?.message || "Unable to restore Results Packet data from that source sheet.");
          } finally {
            restorePacketBtn.disabled = false;
          }
        });
        maintenanceBody.appendChild(restorePacketBtn);
        void appendPostEventCleanupPanel({ eventId, container: maintenanceBody });
      };
      appendBulkCleanupPanel();

      const scheduleEntries = await fetchScheduleEntries(eventId);
      if (state.admin.currentView !== "eventDay" || (state.event.active?.id || "") !== eventId) return;

      const ordered = [...(scheduleEntries || [])].sort((a, b) => {
        const aMs = toDateOrNull(a.performanceAt)?.getTime() || 0;
        const bMs = toDateOrNull(b.performanceAt)?.getTime() || 0;
        return aMs - bMs;
      });
      if (!ordered.length) {
        els.adminPacketsHint.textContent = "No scheduled ensembles for the active event.";
        els.adminPacketsSchoolSelect.innerHTML = "";
        renderAdminPacketsAuditTable({ entries: [], eventId });
        updateAdminPacketsAuditLoadButton({ loaded: false, disabled: true });
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

      const packetDataByEntryId = new Map();
      if (state.admin.packetsAuditLoaded && ordered.length) {
        updateAdminPacketsAuditLoadButton({ loading: true, loaded: true });
        const packetPayloads = await Promise.all(
          ordered.map(async (entry) => {
            const packetData = await getPacketData({ eventId, entry });
            return { entryId: entry.id, packetData };
          })
        );
        if (state.admin.currentView !== "eventDay" || (state.event.active?.id || "") !== eventId) return;
        packetPayloads.forEach(({ entryId, packetData }) => {
          if (!entryId) return;
          packetDataByEntryId.set(entryId, packetData);
        });
        renderAdminPacketsAuditTable({ entries: ordered, packetDataByEntryId, eventId });
        updateAdminPacketsAuditLoadButton({ loaded: true });
      } else if (!state.admin.packetsAuditLoaded) {
        if (els.adminPacketsAuditBody) els.adminPacketsAuditBody.innerHTML = "";
        if (els.adminPacketsAuditHint) {
          els.adminPacketsAuditHint.textContent =
            "Load Release Audit to review director-release status across the full event.";
        }
      }
      if (!state.admin.packetsSchoolId) {
        els.adminPacketsHint.textContent = "Select a school to load official results review.";
        return;
      }
      const filtered = ordered.filter((entry) => (entry.schoolId || "") === state.admin.packetsSchoolId);
      if (!filtered.length) {
        els.adminPacketsHint.textContent =
          "No scheduled ensembles found for this school. Loading Open Judge sheets...";
      } else {
        els.adminPacketsHint.textContent = "Loading results packet status for selected school...";
      }
      let reviewedCount = 0;
      let releaseReadyCount = 0;
      let releasedCount = 0;
      if (!state.admin.packetsAuditLoaded && filtered.length) {
        const packetPayloads = await Promise.all(
          filtered.map(async (entry) => {
            const packetData = await getPacketData({ eventId, entry });
            return { entryId: entry.id, packetData };
          })
        );
        if (state.admin.currentView !== "eventDay" || (state.event.active?.id || "") !== eventId) return;
        packetPayloads.forEach(({ entryId, packetData }) => {
          if (!entryId) return;
          packetDataByEntryId.set(entryId, packetData);
        });
      }
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
        const summary = augmentSummary(packetData?.summary || null, packetData?.submissions || {});
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

        if (summary?.commentsOnly) {
          const commentsOnlyMeta = document.createElement("div");
          commentsOnlyMeta.className = "note";
          commentsOnlyMeta.textContent = "Comments Only: this ensemble will receive comments only. Caption grades and ratings are suppressed as CO.";
          li.appendChild(commentsOnlyMeta);
        }

        const releaseMeta = document.createElement("div");
        releaseMeta.className = "note";
        releaseMeta.textContent = summary?.requiredReleased ?
          "Director Release: Released to director." :
          "Director Release: Not released to director.";
        li.appendChild(releaseMeta);

        if (summary?.hasPartialReleaseState) {
          const partialNote = document.createElement("div");
          partialNote.className = "note";
          partialNote.textContent = `Partial release detected: ${summary.releasedPositions
            .map((position) => JUDGE_POSITION_LABELS[position] || position)
            .join(", ")} already marked released. Repair before releasing this packet.`;
          li.appendChild(partialNote);
        }

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

        const commentsOnlyBtn = document.createElement("button");
        commentsOnlyBtn.type = "button";
        commentsOnlyBtn.className = "ghost";
        commentsOnlyBtn.textContent = summary?.commentsOnly ? "Clear Comments Only" : "Force Comments Only";
        commentsOnlyBtn.addEventListener("click", async () => {
          const nextValue = !summary?.commentsOnly;
          const reason = nextValue ?
            String(window.prompt("Optional reason for forcing Comments Only:", "") || "").trim() :
            "";
          const ok = confirmUser(
            nextValue ?
              `Force ${schoolName} - ${ensembleName} to Comments Only?\n\nJudge ratings and packet overall will display as CO, and caption grades will be suppressed in Results Packet views and exports.` :
              `Clear Comments Only for ${schoolName} - ${ensembleName}?\n\nThis will restore normal ratings from the existing caption data where available.`
          );
          if (!ok) return;
          commentsOnlyBtn.disabled = true;
          try {
            await setPacketCommentsOnly({ eventId, ensembleId, commentsOnly: nextValue, reason });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            await renderAdminPacketsBySchedule();
          } catch (error) {
            console.error("setPacketCommentsOnly failed", error);
            alertUser(error?.message || "Unable to update Comments Only state.");
          } finally {
            commentsOnlyBtn.disabled = false;
          }
        });
        actions.appendChild(commentsOnlyBtn);

        if (summary?.hasPartialReleaseState) {
          const repairReleaseBtn = document.createElement("button");
          repairReleaseBtn.type = "button";
          repairReleaseBtn.className = "ghost";
          repairReleaseBtn.textContent = "Repair Release State";
          repairReleaseBtn.addEventListener("click", async () => {
            const ok = confirmUser(
              `Repair partial release state for ${schoolName} - ${ensembleName}?\n\nThis will reset prematurely released sheet statuses back to an unreleased packet state and revoke the existing director packet export. Scores, comments, and tape data stay intact.`
            );
            if (!ok) return;
            repairReleaseBtn.disabled = true;
            try {
              const result = await repairPacketReleaseState({ eventId, ensembleId });
              scheduleAdminPreflightRefresh?.({ immediate: true });
              await renderAdminPacketsBySchedule();
              alertUser(
                `Release state repaired.\n` +
                `Scope: ${schoolName} - ${ensembleName}\n` +
                `Released early: ${(result.releasedPositions || [])
                  .map((position) => JUDGE_POSITION_LABELS[position] || position)
                  .join(", ") || "None"}`
              );
            } catch (error) {
              console.error("repairPacketReleaseState failed", error);
              alertUser(error?.message || "Unable to repair release state.");
            } finally {
              repairReleaseBtn.disabled = false;
            }
          });
          actions.appendChild(repairReleaseBtn);
        }

        const repairMetadataBtn = document.createElement("button");
        repairMetadataBtn.type = "button";
        repairMetadataBtn.className = "ghost";
        repairMetadataBtn.textContent = "Repair Packet Metadata";
        repairMetadataBtn.addEventListener("click", async () => {
          const ok = confirmUser(
            `Repair metadata for ${schoolName} - ${ensembleName} from the released packet export?\n\n` +
            `This syncs the released packet grade back into the event entry, schedule rows, school registration, and school ensemble record.`
          );
          if (!ok) return;
          repairMetadataBtn.disabled = true;
          try {
            const result = await repairReleasedPacketMetadata({ eventId, ensembleId });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            await renderAdminPacketsBySchedule();
            alertUser(
              `Packet metadata repaired.\n` +
              `Grade: ${result.grade || "Unknown"}\n` +
              `Schedule rows updated: ${result.updatedScheduleRows || 0}\n` +
              `Duplicate schedule rows detected: ${result.duplicateScheduleRowsDetected || 0}`
            );
          } catch (error) {
            console.error("repairReleasedPacketMetadata failed", error);
            alertUser(error?.message || "Unable to repair packet metadata.");
          } finally {
            repairMetadataBtn.disabled = false;
          }
        });
        actions.appendChild(repairMetadataBtn);

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

        const restitchBtn = document.createElement("button");
        restitchBtn.type = "button";
        restitchBtn.className = "ghost";
        restitchBtn.textContent = "Restitch This Packet Tape";
        restitchBtn.addEventListener("click", async () => {
          const runDry = window.confirm(
            "Run a DRY RUN first?\nOK = Dry run only (safe preview)\nCancel = Apply fixes now"
          );
          restitchBtn.disabled = true;
          try {
            const result = await repairOpenSubmissionAudioMetadata({
              dryRun: runDry,
              eventId,
              schoolId: entry.schoolId || "",
              ensembleId,
            });
            const firstFailurePacketId = Array.isArray(result.failures) && result.failures.length ?
              String(result.failures[0].packetId || "").trim() :
              "";
            const failureLines = Array.isArray(result.failures) ? result.failures.slice(0, 5).map((failure) => {
              const slotLabel = JUDGE_POSITION_LABELS[failure.judgePosition] || failure.judgePosition || "Unknown Slot";
              const triedPaths = Array.isArray(failure.audioPathsTried) && failure.audioPathsTried.length ?
                `\n  Paths tried: ${failure.audioPathsTried.join(", ")}` :
                "";
              return `- ${slotLabel} | Packet ${failure.packetId || "unknown"}\n  ${failure.message || "Repair failed."}${triedPaths}`;
            }) : [];
            await renderAdminPacketsBySchedule();
            alertUser(
              `${runDry ? "Dry run complete" : "Packet tape restitch complete"}.\n` +
              `Scope: ${schoolName} - ${ensembleName}\n` +
              `Open packets updated: ${result.packetsUpdated || 0}\n` +
              `Submission docs updated: ${result.submissionsUpdated || 0}\n` +
              `Official assessments updated: ${result.officialAssessmentsUpdated || 0}\n` +
              `Results packet exports updated: ${result.exportsUpdated || 0}\n` +
              `Skipped (no sessions): ${result.skippedNoSessions || 0}\n` +
              `Skipped (no canonical slot or stitched tape): ${result.skippedNoSubmission || 0}\n` +
              `Failed packets: ${result.failedPackets || 0}` +
              (failureLines.length ? `\nFailures:\n${failureLines.join("\n")}` : "")
            );
            if (firstFailurePacketId) {
              const shouldOpen = confirmUser(
                `Open failing Source Sheet ${firstFailurePacketId} now?`
              );
              if (shouldOpen) {
                const opened = openSourceSheetFromResultsView(firstFailurePacketId);
                if (!opened) {
                  alertUser(`Unable to find Source Sheet ${firstFailurePacketId} in the current list.`);
                }
              }
            }
          } catch (error) {
            console.error("repairOpenSubmissionAudioMetadata failed", error);
            alertUser(error?.message || "Unable to restitch packet tape.");
          } finally {
            restitchBtn.disabled = false;
          }
        });
        actions.appendChild(restitchBtn);

        const recreateSourceBtn = document.createElement("button");
        recreateSourceBtn.type = "button";
        recreateSourceBtn.className = "ghost";
        recreateSourceBtn.textContent = "Recreate Missing Source Sheet";
        recreateSourceBtn.addEventListener("click", async () => {
          const rawChoice = window.prompt(
            `Enter the judge position to recreate from the Results Packet (${(summary?.requiredPositions || [])
              .map((position) => JUDGE_POSITION_LABELS[position] || position)
              .join(", ")}):`,
            ""
          );
          const judgePosition = String(rawChoice || "").trim().toLowerCase();
          if (!judgePosition) return;
          if (!(summary?.requiredPositions || []).includes(judgePosition)) {
            alertUser("Invalid judge position for this Results Packet.");
            return;
          }
          const ok = confirmUser(
            `Recreate a Source Sheet for ${schoolName} - ${ensembleName} (${JUDGE_POSITION_LABELS[judgePosition] || judgePosition}) from the current Results Packet record?\n\nThis creates a reconstructed locked Source Sheet behind the official slot. It does not change the Results Packet itself.`
          );
          if (!ok) return;
          recreateSourceBtn.disabled = true;
          try {
            const result = await recreateOpenPacketFromCanonical({
              eventId,
              ensembleId,
              judgePosition,
              schoolId: entry.schoolId || "",
              schoolName,
              ensembleName,
            });
            await renderAdminPacketsBySchedule();
            alertUser(
              result.recreated === false ?
                `A Source Sheet already exists for ${JUDGE_POSITION_LABELS[judgePosition] || judgePosition}.\nSource Sheet ID: ${result.packetId || "Unknown"}` :
                `Source Sheet recreated.\nJudge Slot: ${JUDGE_POSITION_LABELS[judgePosition] || judgePosition}\nSource Sheet ID: ${result.packetId || "Unknown"}`
            );
          } catch (error) {
            console.error("recreateOpenPacketFromCanonical failed", error);
            alertUser(error?.message || "Unable to recreate source sheet from Results Packet.");
          } finally {
            recreateSourceBtn.disabled = false;
          }
        });
        actions.appendChild(recreateSourceBtn);

        const tracePanel = document.createElement("div");
        tracePanel.className = "packet-panel is-hidden";
        const traceBtn = document.createElement("button");
        traceBtn.type = "button";
        traceBtn.className = "ghost";
        traceBtn.textContent = "Trace Release Status";
        traceBtn.addEventListener("click", async () => {
          const isHidden = tracePanel.classList.contains("is-hidden");
          if (isHidden) {
            tracePanel.classList.remove("is-hidden");
            traceBtn.textContent = "Hide Release Trace";
            tracePanel.innerHTML = "";
            const loading = document.createElement("div");
            loading.className = "note";
            loading.textContent = "Tracing release state...";
            tracePanel.appendChild(loading);
            await renderPacketReleaseTrace({
              eventId,
              ensembleId,
              packetData,
              wrapper: tracePanel,
            });
          } else {
            tracePanel.classList.add("is-hidden");
            traceBtn.textContent = "Trace Release Status";
          }
        });
        actions.appendChild(traceBtn);

        const accessTracePanel = document.createElement("div");
        accessTracePanel.className = "packet-panel is-hidden";
        const accessTraceBtn = document.createElement("button");
        accessTraceBtn.type = "button";
        accessTraceBtn.className = "ghost";
        accessTraceBtn.textContent = "Trace Director Access";
        accessTraceBtn.addEventListener("click", async () => {
          const isHidden = accessTracePanel.classList.contains("is-hidden");
          if (isHidden) {
            accessTracePanel.classList.remove("is-hidden");
            accessTraceBtn.textContent = "Hide Director Access Trace";
            accessTracePanel.innerHTML = "";
            const loading = document.createElement("div");
            loading.className = "note";
            loading.textContent = "Tracing director access...";
            accessTracePanel.appendChild(loading);
            await renderDirectorAccessTrace({
              eventId,
              entry,
              packetData: {
                ...packetData,
                entrySchoolId: entry.schoolId || "",
              },
              wrapper: accessTracePanel,
            });
          } else {
            accessTracePanel.classList.add("is-hidden");
            accessTraceBtn.textContent = "Trace Director Access";
          }
        });
        actions.appendChild(accessTraceBtn);

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
        li.appendChild(tracePanel);
        li.appendChild(accessTracePanel);

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
      if (state.admin.currentView !== "eventDay" || (state.event.active?.id || "") !== eventId) return;
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
      openTitle.textContent = "Source Sheets";
      openSection.appendChild(openTitle);
      const openHint = document.createElement("p");
      openHint.className = "hint";
      openHint.textContent =
        "Action-needed source sheets for this school. Source sheets already behind the Results Packet are hidden below unless you reveal them for recovery.";
      openSection.appendChild(openHint);

      const buildExpectedOpenSubmissionId = (packet) => {
        const officialEventId = String(packet?.officialEventId || packet?.assignmentEventId || "").trim();
        const ensembleId = String(packet?.ensembleId || "").trim();
        const judgePosition = String(packet?.officialJudgePosition || packet?.judgePosition || "").trim();
        if (!officialEventId || !ensembleId || !judgePosition) return "";
        return `${officialEventId}_${ensembleId}_${judgePosition}`;
      };
      const conflictsBySubmissionId = new Map();
      openPackets.forEach((packet) => {
        if (String(packet.mode || "").trim().toLowerCase() !== "official") return;
        const submissionId = buildExpectedOpenSubmissionId(packet);
        if (!submissionId) return;
        const existing = conflictsBySubmissionId.get(submissionId) || [];
        existing.push(packet);
        conflictsBySubmissionId.set(submissionId, existing);
      });
      const conflictingGroups = Array.from(conflictsBySubmissionId.entries())
        .filter(([, packets]) => packets.length > 1);

      if (conflictingGroups.length) {
        const conflictPanel = document.createElement("div");
        conflictPanel.className = "note";
        conflictPanel.innerHTML = `<strong>Conflicts detected:</strong> ${conflictingGroups.length} duplicate official slot${
          conflictingGroups.length === 1 ? "" : "s"
        } found. These open sheets target the same deterministic submission and need manual review before repair/release.`;
        openSection.appendChild(conflictPanel);
      }

      const classifyOpenPacket = (packet) => {
        const isOfficialPacket = String(packet.mode || "").trim().toLowerCase() === "official";
        const expectedSubmissionId = buildExpectedOpenSubmissionId(packet);
        const conflictingPackets = isOfficialPacket && expectedSubmissionId ?
          (conflictsBySubmissionId.get(expectedSubmissionId) || []).filter((item) => item.id !== packet.id) :
          [];
        const linkedSubmissionId =
          String(packet.officialSubmissionId || packet.officialAssessmentId || "").trim();
        const isCanonicalLinked =
          isOfficialPacket &&
          expectedSubmissionId &&
          !conflictingPackets.length &&
          linkedSubmissionId === expectedSubmissionId;
        return {
          isOfficialPacket,
          expectedSubmissionId,
          conflictingPackets,
          isCanonicalLinked,
        };
      };

      const actionPackets = [];
      const attachedSourcePackets = [];
      openPackets.forEach((packet) => {
        const classified = classifyOpenPacket(packet);
        if (classified.isCanonicalLinked) {
          attachedSourcePackets.push({ packet, ...classified });
        } else {
          actionPackets.push({ packet, ...classified });
        }
      });

      const buildOpenPacketRow = ({
        packet,
        isOfficialPacket,
        expectedSubmissionId,
        conflictingPackets,
        isCanonicalLinked = false,
      }) => {
        const row = document.createElement("div");
        row.className = "panel";
        row.dataset.sourcePacketId = packet.id;
        const top = document.createElement("div");
        top.className = "row row--between row--center";
        const title = document.createElement("strong");
        title.textContent = `${packet.schoolName || "School"} - ${packet.ensembleName || "Ensemble"}`;
        top.appendChild(title);
        const badges = document.createElement("div");
        badges.className = "row";
        const modeBadge = document.createElement("span");
        modeBadge.className = "badge";
        modeBadge.textContent = isOfficialPacket ? "OFFICIAL" : "PRACTICE";
        badges.appendChild(modeBadge);
        const statusBadge = document.createElement("span");
        statusBadge.className = "badge";
        statusBadge.textContent = formatRawAssessmentStatus(packet.status || "draft");
        badges.appendChild(statusBadge);
        const formBadge = document.createElement("span");
        formBadge.className = "badge";
        formBadge.textContent = (packet.formType || "stage").toUpperCase();
        badges.appendChild(formBadge);
        if (conflictingPackets.length) {
          const conflictBadge = document.createElement("span");
          conflictBadge.className = "badge status--warn";
          conflictBadge.textContent = "CONFLICT";
          badges.appendChild(conflictBadge);
        }
        top.appendChild(badges);
        row.appendChild(top);

        const meta = document.createElement("div");
        meta.className = "note";
        const judgeLabel =
          packet.createdByJudgeName ||
          packet.createdByJudgeEmail ||
          packet.createdByJudgeUid ||
          "Unknown judge";
        const ratingLabel = packet.commentsOnly ? "CO" : (packet.computedFinalRatingLabel || "N/A");
        const updatedLabel = formatPacketTimestamp(packet.updatedAt) || "Recently updated";
        meta.textContent = `Judge: ${judgeLabel} - Judge Overall Rating: ${ratingLabel} - Updated: ${updatedLabel}`;
        row.appendChild(meta);
        if (isOfficialPacket && expectedSubmissionId) {
          const targetMeta = document.createElement("div");
          targetMeta.className = "note";
          targetMeta.textContent = `Results Packet Slot: ${expectedSubmissionId}`;
          row.appendChild(targetMeta);
        }
        if (isCanonicalLinked) {
          const attachedMeta = document.createElement("div");
          attachedMeta.className = "note";
          attachedMeta.textContent =
            "Source sheet behind Results Packet only. The Results Packet remains the source of truth.";
          row.appendChild(attachedMeta);
        }
        if (conflictingPackets.length) {
          const conflictMeta = document.createElement("div");
          conflictMeta.className = "note";
          conflictMeta.innerHTML = `<strong>Conflict:</strong> also targeted by ${conflictingPackets
            .map((item) => item.id)
            .join(", ")}`;
          row.appendChild(conflictMeta);
        }

        const actions = document.createElement("div");
        actions.className = "row";
        if (isOfficialPacket && expectedSubmissionId) {
          const resolveBtn = document.createElement("button");
          resolveBtn.type = "button";
          resolveBtn.textContent = "Use This Sheet in Results Packet";
          resolveBtn.addEventListener("click", async () => {
            const ok = confirmUser(
              `Restore the Results Packet slot ${expectedSubmissionId || "submission"} from Source Sheet ${packet.id}?\n\n` +
              `This uses this sheet as the source of truth for that Results Packet slot and overwrites the current official record for that judge position.`
            );
            if (!ok) return;
            resolveBtn.disabled = true;
            try {
              await restoreCanonicalFromOpenPacket({ packetId: packet.id, dryRun: false });
              scheduleAdminPreflightRefresh?.({ immediate: true });
              await renderAdminPacketsBySchedule();
              alertUser(
                `Results Packet slot restored from Source Sheet ${packet.id}.\n` +
                `Review and delete any duplicate conflicting source sheets if they are no longer needed.`
              );
            } catch (error) {
              console.error("Conflict resolution restore failed", error);
              alertUser(error?.message || "Unable to restore canonical data from this open sheet.");
            } finally {
              resolveBtn.disabled = false;
            }
          });
          actions.appendChild(resolveBtn);
        }
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "ghost";
        viewBtn.textContent = "View Source Sheet";
        viewBtn.dataset.sourcePacketViewFor = packet.id;
        const detail = document.createElement("div");
        detail.className = "packet-panel is-hidden";
        viewBtn.addEventListener("click", async () => {
          const isHidden = detail.classList.contains("is-hidden");
          detail.classList.toggle("is-hidden", !isHidden);
          viewBtn.textContent = isHidden ? "Hide Source Sheet" : "View Source Sheet";
          if (isHidden) {
            detail.innerHTML = "";
            const topMeta = document.createElement("div");
            topMeta.className = "note";
            topMeta.textContent = `Source Sheet ID: ${packet.id} - Updated: ${formatPacketTimestamp(packet.updatedAt) || "Recently updated"}`;
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
            lockBtn.textContent = isLocked ? "Unlock Source Sheet" : "Lock Source Sheet";
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
            if (isOfficialPacket && conflictingPackets.length) {
              releaseBtn.disabled = true;
              releaseBtn.title = "Resolve conflicting official open sheets for this slot before releasing.";
            }
            releaseBtn.addEventListener("click", async () => {
              if (releaseBtn.disabled) return;
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
          const replacePrimary = confirmUser(
            "Replace the primary tape on this Source Sheet?\n\n" +
            "OK = Replace Primary Tape\n" +
            "Cancel = Attach as Supplemental Audio"
          );
          const file = await pickAudioFile();
          if (!file) return;
          setManualAudioStatus(openStatusKey, `Uploading ${file.name}...`);
          await renderAdminPacketsBySchedule();
          attachOpenAudioBtn.disabled = true;
          try {
            await attachManualAudioToOpenPacket({
              packetId: packet.id,
              file,
              mode: replacePrimary ? "primary" : "supplemental",
            });
            setManualAudioStatus(
              openStatusKey,
              replacePrimary ?
                "Upload complete. Primary tape replaced on source sheet." :
                "Upload complete. Supplemental audio attached to source sheet."
            );
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
        deleteBtn.textContent = "Delete Source Sheet";
        const openStatus = normalizeOpenPacketStatus(packet.status);
        if (openStatus === "released") {
          deleteBtn.disabled = true;
          deleteBtn.title = "Unrelease open sheet first.";
        }
        deleteBtn.addEventListener("click", async () => {
          const label = `${packet.schoolName || "School"} - ${packet.ensembleName || "Ensemble"}`;
          const deleteMessage = isCanonicalLinked ?
            `Delete Source Sheet for ${label}?\n\nThis removes only the source sheet and its tape/session artifacts. The Results Packet remains intact.` :
            `Delete Source Sheet for ${label}?\n\nThis removes the source sheet, tape, and sessions.`;
          const ok = confirmUser(deleteMessage);
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
        return row;
      };

      if (!actionPackets.length) {
        const empty = document.createElement("div");
        empty.className = "note";
        empty.textContent = attachedSourcePackets.length
          ? "No action-needed source sheets. All remaining source sheets are attached below for recovery only."
          : "No Source Sheets found for this school.";
        openSection.appendChild(empty);
      } else {
        const openList = document.createElement("div");
        openList.className = "stack";
        actionPackets.forEach((item) => {
          openList.appendChild(buildOpenPacketRow(item));
        });
        openSection.appendChild(openList);
      }

      if (attachedSourcePackets.length) {
        const attachedWrap = document.createElement("div");
        attachedWrap.className = "stack";
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "ghost";
        toggleBtn.dataset.attachedSourceToggle = "1";
        toggleBtn.dataset.expanded = "false";
        toggleBtn.textContent = `Show Source Sheets Behind Results Packet (${attachedSourcePackets.length})`;
        const attachedHint = document.createElement("div");
        attachedHint.className = "note is-hidden";
        attachedHint.textContent =
          "These source sheets are hidden from the main list because the Results Packet slot already exists. Reveal them only for recovery or tape troubleshooting.";
        const attachedList = document.createElement("div");
        attachedList.className = "stack is-hidden";
        toggleBtn.addEventListener("click", () => {
          const shouldShow = attachedList.classList.contains("is-hidden");
          attachedList.classList.toggle("is-hidden", !shouldShow);
          attachedHint.classList.toggle("is-hidden", !shouldShow);
          toggleBtn.dataset.expanded = shouldShow ? "true" : "false";
          toggleBtn.textContent = shouldShow ?
            `Hide Source Sheets Behind Results Packet (${attachedSourcePackets.length})` :
            `Show Source Sheets Behind Results Packet (${attachedSourcePackets.length})`;
        });
        attachedWrap.appendChild(toggleBtn);
        attachedWrap.appendChild(attachedHint);
        attachedSourcePackets.forEach((item) => {
          attachedList.appendChild(buildOpenPacketRow(item));
        });
        attachedWrap.appendChild(attachedList);
        openSection.appendChild(attachedWrap);
      }
      els.adminPacketsList.appendChild(openSection);
      els.adminPacketsHint.textContent = "";
    } catch (error) {
      console.error("renderAdminPacketsBySchedule failed", error);
      if (els.adminPacketsHint) {
        els.adminPacketsHint.textContent = "Unable to load results review right now.";
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

  const SLOT_MINUTES_BY_GRADE = { I: 25, II: 25, III: 30, IV: 30, V: 35, VI: 40 };

  function getSlotMinutesForGrade(grade) {
    const raw = String(grade || "").trim().toUpperCase();
    if (SLOT_MINUTES_BY_GRADE[raw]) return SLOT_MINUTES_BY_GRADE[raw];
    if (raw.includes("/")) {
      const parts = raw.split("/");
      if (SLOT_MINUTES_BY_GRADE[parts[1]]) return SLOT_MINUTES_BY_GRADE[parts[1]];
      if (SLOT_MINUTES_BY_GRADE[parts[0]]) return SLOT_MINUTES_BY_GRADE[parts[0]];
    }
    return 30;
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
      const eventName = state.event.active?.name || "Active Event";
      if (!eventId) {
        const li = document.createElement("li");
        li.className = "hint";
        li.textContent = "No active event set.";
        els.adminRegisteredEnsemblesList.appendChild(li);
        schedulePreEventGuidedFlowRender();
        return;
      }

      const loadingLi = document.createElement("li");
      loadingLi.className = "hint";
      loadingLi.textContent = "Loading\u2026";
      els.adminRegisteredEnsemblesList.appendChild(loadingLi);

      const [scheduleEntries, entriesSnap] = await Promise.all([
        fetchScheduleEntries(eventId),
        getDocs(collection(db, COLLECTIONS.events, eventId, COLLECTIONS.entries)),
      ]);

      state.event.rosterEntries = Array.isArray(scheduleEntries) ? [...scheduleEntries] : [];

      const entryDataByEnsemble = new Map();
      entriesSnap.forEach((snap) => {
        if (!snap?.exists()) return;
        entryDataByEnsemble.set(snap.id, snap.data());
      });

      const schoolIdSet = new Set();
      (state.admin.schoolsList || []).forEach((school) => school?.id && schoolIdSet.add(school.id));
      (scheduleEntries || []).forEach((row) => row?.schoolId && schoolIdSet.add(row.schoolId));
      entriesSnap.forEach((snap) => {
        const schoolId = String(snap.data()?.schoolId || "").trim();
        if (schoolId) schoolIdSet.add(schoolId);
      });

      const schoolEnsembleSnaps = await Promise.all(
        [...schoolIdSet].map((schoolId) =>
          getDocs(collection(db, COLLECTIONS.schools, schoolId, COLLECTIONS.ensembles))
            .then((snap) => ({ schoolId, docs: snap.docs }))
            .catch(() => ({ schoolId, docs: [] }))
        )
      );
      const schoolEnsembleById = new Map();
      const schoolEnsembleByNameKey = new Map();
      schoolEnsembleSnaps.forEach(({ schoolId, docs }) => {
        docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const ensembleId = String(docSnap.id || "").trim();
          if (ensembleId) {
            schoolEnsembleById.set(`${schoolId}__${ensembleId}`, data);
          }
          const nameKey = `${schoolId}|${String(data.name || "").toLowerCase().trim()}`;
          if (nameKey !== `${schoolId}|`) {
            schoolEnsembleByNameKey.set(nameKey, data);
          }
        });
      });

      els.adminRegisteredEnsemblesList.innerHTML = "";

      const visible = (scheduleEntries || []).filter((e) => e.hidden !== true);
      if (!visible.length) {
        const li = document.createElement("li");
        li.className = "hint";
        li.textContent = `${eventName} has no scheduled ensembles yet.`;
        els.adminRegisteredEnsemblesList.appendChild(li);
        schedulePreEventGuidedFlowRender();
        return;
      }

      const sorted = [...visible].sort((a, b) => {
        const aMs = toDateOrNull(a.performanceAt)?.getTime() ?? Infinity;
        const bMs = toDateOrNull(b.performanceAt)?.getTime() ?? Infinity;
        return aMs - bMs;
      });

      const tableWrap = document.createElement("div");
      tableWrap.className = "schedule-timeline-table-wrap";
      const table = document.createElement("table");
      table.className = "schedule-timeline-table";
      table.innerHTML = "<thead><tr><th>Holding</th><th>Warm-up</th><th>Performance</th><th>School</th><th>Ensemble</th><th>Grade</th><th>Status</th><th></th></tr></thead>";
      const tbody = document.createElement("tbody");

      sorted.forEach((sched) => {
        const ensembleId = sched.ensembleId || sched.id;
        const schoolId = sched.schoolId || "";
        const schoolName = sched.schoolName || getSchoolNameById(state.admin.schoolsList, schoolId) || "\u2014";
        const entryData = entryDataByEnsemble.get(ensembleId) || {};
        const fallbackSchoolEnsemble =
          schoolEnsembleById.get(`${schoolId}__${ensembleId}`) ||
          schoolEnsembleByNameKey.get(`${schoolId}|${String(sched.ensembleName || "").toLowerCase().trim()}`) ||
          {};
        const grade =
          entryData.declaredGradeLevel ||
          entryData.performanceGrade ||
          fallbackSchoolEnsemble.declaredGradeLevel ||
          fallbackSchoolEnsemble.performanceGrade ||
          sched.grade ||
          "\u2014";
        const ensembleName = normalizeEnsembleDisplayName({
          schoolName,
          ensembleName: sched.ensembleName || entryData.ensembleName || "",
          ensembleId,
        }) || "\u2014";

        const perfAt = toDateOrNull(sched.performanceAt);
        const slotMin = getSlotMinutesForGrade(grade);
        const warmUpStart = perfAt ? new Date(perfAt.getTime() - slotMin * 60000) : null;
        const holdingStart = warmUpStart ? new Date(warmUpStart.getTime() - slotMin * 60000) : null;

        const isRegistered = entryDataByEnsemble.has(ensembleId);
        const statusStr = String(entryData.status || "").trim().toLowerCase();
        const statusLabel = statusStr === "ready" ? "Director Ready" : isRegistered ? "In Progress" : "Not Registered";

        const tr = document.createElement("tr");
        if (!isRegistered) tr.classList.add("is-unregistered");

        const td = (text) => {
          const cell = document.createElement("td");
          cell.textContent = text;
          return cell;
        };
        tr.appendChild(td(formatStartTime(holdingStart)));
        tr.appendChild(td(formatStartTime(warmUpStart)));
        tr.appendChild(td(formatStartTime(perfAt)));
        tr.appendChild(td(schoolName));
        tr.appendChild(td(ensembleName));
        tr.appendChild(td(grade));
        tr.appendChild(td(statusLabel));

        const actionTd = document.createElement("td");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn--secondary";
        btn.textContent = "Open";
        btn.addEventListener("click", () => {
          state.admin.selectedSchoolId = schoolId;
          state.admin.selectedSchoolName = schoolName;
          applyAdminView("eventPrep");
        });
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      tableWrap.appendChild(table);
      const li = document.createElement("li");
      li.appendChild(tableWrap);
      els.adminRegisteredEnsemblesList.appendChild(li);

      schedulePreEventGuidedFlowRender();
    } catch (err) {
      console.error("Failed to load scheduled ensembles:", err);
      els.adminRegisteredEnsemblesList.innerHTML = "";
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "Failed to load data. Please check your connection and refresh.";
      els.adminRegisteredEnsemblesList.appendChild(li);
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

  // ── Schedule Builder ──────────────────────────────────────────────────────

  // In-memory model lives here so it survives re-renders without re-fetching
  let schedulerModel = null;
  let schedulerRegisteredEntries = [];

  function buildEntryMeta(registeredEntries) {
    const meta = new Map();
    for (const entry of registeredEntries) {
      const ensembleId = entry.ensembleId || entry.id;
      const schoolId = entry.schoolId || "";
      const schoolName = entry.schoolName || getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
      const ensembleName = normalizeEnsembleDisplayName({
        schoolName,
        ensembleName: entry.ensembleName || "",
        ensembleId,
      }) || ensembleId;
      meta.set(ensembleId, {
        schoolId,
        schoolName,
        ensembleName,
        grade: entry.performanceGrade || entry.declaredGradeLevel || "",
        _unregistered: Boolean(entry._unregistered),
      });
    }
    return meta;
  }

  async function renderScheduleBuilder() {
    const container = els.adminScheduleBuilderContent;
    if (!container) return;

    const eventId = state.event.active?.id;
    if (!eventId) {
      container.innerHTML = "<p class='hint'>No active event set.</p>";
      return;
    }

    container.innerHTML = "<p class='hint'>Loading\u2026</p>";

    try {
      const [scheduleEntries, registeredEntries] = await Promise.all([
        fetchScheduleEntries(eventId),
        fetchRegisteredEnsembles(eventId),
      ]);

      // Collect all school IDs from every available source so we don't miss any school
      // (e.g. schools not yet in state.admin.schoolsList due to snapshot timing).
      const schoolIdSet = new Set();
      (state.admin.schoolsList || []).forEach((s) => s.id && schoolIdSet.add(s.id));
      registeredEntries.forEach((e) => e.schoolId && schoolIdSet.add(e.schoolId));
      scheduleEntries.forEach((e) => e.schoolId && schoolIdSet.add(e.schoolId));

      // Fetch each school's ensembles sub-collection in parallel.
      const subSnaps = await Promise.all(
        [...schoolIdSet].map((schoolId) =>
          getDocs(collection(db, COLLECTIONS.schools, schoolId, COLLECTIONS.ensembles))
            .then((snap) => snap.docs.map((d) => ({ id: d.id, schoolId, ...d.data() })))
            .catch(() => [])
        )
      );
      const allSubEnsembles = subSnaps.flat();

      // Merge: registered entries take precedence (keyed by ensembleId);
      // sub-collection docs not already covered by a registered entry become stubs.
      const registeredByEnsembleId = new Map(registeredEntries.map((e) => [e.ensembleId || e.id, e]));

      // Secondary dedup key: schoolId + lowercased ensembleName, to handle data inconsistencies
      // where the sub-collection doc ID differs from the ensembleId stored in the entry.
      const registeredNameKeys = new Set(
        registeredEntries.map((e) => `${e.schoolId}|${String(e.ensembleName || "").toLowerCase().trim()}`)
      );

      const merged = [...registeredEntries];
      allSubEnsembles.forEach((data) => {
        const nameKey = `${data.schoolId}|${String(data.name || "").toLowerCase().trim()}`;
        if (registeredByEnsembleId.has(data.id)) return;        // same ensembleId → already covered
        if (registeredNameKeys.has(nameKey) && nameKey !== `${data.schoolId}|`) return; // same ensemble, different ID
        merged.push({
          id: data.id,
          ensembleId: data.id,
          schoolId: data.schoolId || "",
          ensembleName: data.name || "",
          performanceGrade: String(data.performanceGrade || "").trim(),
          declaredGradeLevel: String(data.declaredGradeLevel || "").trim(),
          performanceGradeFlex: Boolean(data.performanceGradeFlex),
          declaredGradeFlex: Boolean(data.declaredGradeFlex),
          _unregistered: true,
        });
      });

      schedulerRegisteredEntries = merged;
      const event = state.event.active || {};
      const eventStartAt = toDateOrNull(event.startAt);

      schedulerModel = buildSlotModelFromFirestore(
        scheduleEntries,
        event.scheduleBreaks || [],
        event.scheduleDayBreaks || {},
        eventStartAt,
      );
    } catch (err) {
      console.error("Schedule Builder: failed to load data", err);
      container.innerHTML = "<p class='hint'>Failed to load data. Check your connection and try again.</p>";
      return;
    }

    renderScheduleBuilderUI();
  }

  function renderScheduleBuilderUI() {
    const container = els.adminScheduleBuilderContent;
    if (!container || !schedulerModel) return;

    const entryMeta = buildEntryMeta(schedulerRegisteredEntries);
    const scheduledIds = getScheduledEnsembleIds(schedulerModel);
    const totalEnsembleSlots = countEnsembleSlots(schedulerModel);
    const errors = validateSlotModel(schedulerModel);
    const MAX_PER_DAY = 18;

    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "schedule-builder-wrap";

    const days = schedulerModel.days;

    days.forEach((day, dayIndex) => {
      const dayDiv = document.createElement("div");
      dayDiv.className = "schedule-builder-day";

      // Day header
      const header = document.createElement("div");
      header.className = "schedule-builder-day-header";

      const title = document.createElement("span");
      title.className = "schedule-builder-day-title";
      title.textContent = `Day ${dayIndex + 1}${day.dateLabel ? ` — ${day.dateLabel}` : ""}`;
      header.appendChild(title);

      // Start time input
      const timeLabel = document.createElement("label");
      timeLabel.style.cssText = "display:flex;align-items:center;gap:6px;font-size:var(--text-sm);";
      timeLabel.textContent = "First Performance: ";
      const timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.value = day.startTime || "08:00";
      timeInput.style.cssText = "font:inherit;font-size:var(--text-sm);padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);";
      timeInput.addEventListener("change", () => {
        schedulerModel.days[dayIndex].startTime = timeInput.value;
        renderScheduleBuilderUI();
      });
      timeLabel.appendChild(timeInput);
      header.appendChild(timeLabel);

      // Slot count badge
      const dayEnsembleCount = day.slots.filter((s) => s.type === "ensemble").length;
      const slotCount = document.createElement("span");
      slotCount.className = `schedule-builder-slot-count${dayEnsembleCount >= MAX_PER_DAY ? " is-full" : ""}`;
      slotCount.textContent = `${dayEnsembleCount} / ${MAX_PER_DAY} bands`;
      header.appendChild(slotCount);

      // Remove day button (only if not the last day)
      const dayActions = document.createElement("div");
      dayActions.className = "schedule-builder-day-actions";
      if (days.length > 1) {
        const removeDayBtn = document.createElement("button");
        removeDayBtn.type = "button";
        removeDayBtn.className = "ghost btn--sm";
        removeDayBtn.textContent = "Remove Day";
        removeDayBtn.addEventListener("click", () => {
          schedulerModel.days.splice(dayIndex, 1);
          renderScheduleBuilderUI();
        });
        dayActions.appendChild(removeDayBtn);
      }
      header.appendChild(dayActions);
      dayDiv.appendChild(header);

      // Table
      const tableWrap = document.createElement("div");
      tableWrap.style.overflowX = "auto";
      const table = document.createElement("table");
      table.className = "schedule-builder-table";
      table.innerHTML = `<thead><tr>
        <th class="col-num">#</th>
        <th class="col-time">Time</th>
        <th class="col-ensemble">Ensemble</th>
        <th class="col-grade">Grade</th>
        <th class="col-slot">Slot</th>
        <th class="col-remove"></th>
      </tr></thead>`;
      const tbody = document.createElement("tbody");

      const getGrade = (ensembleId) => entryMeta.get(ensembleId)?.grade || "";
      const times = computeDaySlotTimes(day, getGrade);

      let ensembleCounter = 0;

      day.slots.forEach((slot, slotIndex) => {
        const tr = document.createElement("tr");
        const { performStart, slotMins } = times[slotIndex] || {};

        const timeStr = performStart
          ? performStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "—";

        if (slot.type === "break") {
          tr.className = "schedule-builder-break-row";
          tr.innerHTML = `
            <td class="col-num">—</td>
            <td class="col-time">${timeStr}</td>
            <td class="col-ensemble" colspan="3">30-minute Break</td>
          `;
          const removeTd = document.createElement("td");
          removeTd.className = "col-remove";
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ghost btn--sm";
          removeBtn.textContent = "✕";
          removeBtn.title = "Remove break";
          removeBtn.addEventListener("click", () => {
            schedulerModel.days[dayIndex].slots.splice(slotIndex, 1);
            renderScheduleBuilderUI();
          });
          removeTd.appendChild(removeBtn);
          tr.appendChild(removeTd);
        } else {
          ensembleCounter++;
          const numTd = document.createElement("td");
          numTd.className = "col-num";
          numTd.textContent = String(ensembleCounter);

          const timeTd = document.createElement("td");
          timeTd.className = "col-time";
          timeTd.textContent = timeStr;

          const ensembleTd = document.createElement("td");
          ensembleTd.className = "col-ensemble";
          const select = document.createElement("select");
          select.className = "schedule-builder-ensemble-select";

          // Build options: blank + all ensembles (unscheduled or currently selected here)
          const blankOpt = document.createElement("option");
          blankOpt.value = "";
          blankOpt.textContent = "— Select ensemble —";
          select.appendChild(blankOpt);

          for (const [ensembleId, meta] of entryMeta) {
            const isScheduledElsewhere = scheduledIds.has(ensembleId) && ensembleId !== slot.ensembleId;
            const opt = document.createElement("option");
            opt.value = ensembleId;
            opt.textContent = `${meta.schoolName} – ${meta.ensembleName}${isScheduledElsewhere ? " (Already Scheduled)" : ""}`;
            opt.disabled = isScheduledElsewhere;
            if (ensembleId === slot.ensembleId) opt.selected = true;
            select.appendChild(opt);
          }

          select.addEventListener("change", () => {
            schedulerModel.days[dayIndex].slots[slotIndex].ensembleId = select.value || null;
            renderScheduleBuilderUI();
          });
          ensembleTd.appendChild(select);

          const grade = slot.ensembleId ? getGrade(slot.ensembleId) : "";
          const gradeTd = document.createElement("td");
          gradeTd.className = "col-grade";
          gradeTd.textContent = grade || "—";

          const slotTd = document.createElement("td");
          slotTd.className = "col-slot";
          slotTd.textContent = slot.ensembleId ? `${slotMins} min` : "—";

          const removeTd = document.createElement("td");
          removeTd.className = "col-remove";
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ghost btn--sm";
          removeBtn.textContent = "✕";
          removeBtn.title = "Remove slot";
          removeBtn.addEventListener("click", () => {
            schedulerModel.days[dayIndex].slots.splice(slotIndex, 1);
            renderScheduleBuilderUI();
          });
          removeTd.appendChild(removeBtn);

          tr.appendChild(numTd);
          tr.appendChild(timeTd);
          tr.appendChild(ensembleTd);
          tr.appendChild(gradeTd);
          tr.appendChild(slotTd);
          tr.appendChild(removeTd);
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      tableWrap.appendChild(table);
      dayDiv.appendChild(tableWrap);

      // Add Slot / Add Break buttons
      const addRow = document.createElement("div");
      addRow.className = "row";
      addRow.style.marginTop = "8px";
      addRow.style.gap = "6px";

      const addSlotBtn = document.createElement("button");
      addSlotBtn.type = "button";
      addSlotBtn.className = "ghost btn--sm";
      addSlotBtn.textContent = "+ Add Slot";
      addSlotBtn.disabled = dayEnsembleCount >= MAX_PER_DAY;
      addSlotBtn.addEventListener("click", () => {
        schedulerModel.days[dayIndex].slots.push({ type: "ensemble", ensembleId: null });
        renderScheduleBuilderUI();
      });

      const addBreakBtn = document.createElement("button");
      addBreakBtn.type = "button";
      addBreakBtn.className = "ghost btn--sm";
      addBreakBtn.textContent = "+ Add Break";
      addBreakBtn.addEventListener("click", () => {
        schedulerModel.days[dayIndex].slots.push({ type: "break" });
        renderScheduleBuilderUI();
      });

      addRow.appendChild(addSlotBtn);
      addRow.appendChild(addBreakBtn);
      dayDiv.appendChild(addRow);

      wrap.appendChild(dayDiv);
    });

    // Add Day button
    const addDayBtn = document.createElement("button");
    addDayBtn.type = "button";
    addDayBtn.className = "ghost btn--sm";
    addDayBtn.textContent = "+ Add Day";
    addDayBtn.addEventListener("click", () => {
      const lastDay = schedulerModel.days[schedulerModel.days.length - 1];
      const lastDate = lastDay?.startDate || new Date();
      const nextDate = new Date(lastDate.getTime() + 86400000);
      schedulerModel.days.push({
        dateLabel: nextDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        startDate: new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate()),
        startTime: "08:00",
        slots: [],
      });
      renderScheduleBuilderUI();
    });
    wrap.appendChild(addDayBtn);

    // Unscheduled list — registered entries not yet placed, plus known ensembles without entries
    const unscheduled = [...entryMeta.entries()].filter(([id]) => !scheduledIds.has(id));
    if (unscheduled.length) {
      const unschedDiv = document.createElement("div");
      unschedDiv.className = "schedule-builder-unscheduled";

      const unschedTitle = document.createElement("div");
      unschedTitle.style.cssText = "font-weight:600;margin-bottom:4px;";
      unschedTitle.textContent = `Unscheduled (${unscheduled.filter(([, m]) => !m._unregistered).length} registered, ${unscheduled.filter(([, m]) => m._unregistered).length} without entry):`;
      unschedDiv.appendChild(unschedTitle);

      for (const [ensembleId, meta] of unscheduled) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 0;";

        const label = document.createElement("span");
        label.textContent = `${meta.schoolName} – ${meta.ensembleName}`;
        if (meta._unregistered) {
          label.style.color = "var(--muted)";
          label.title = "No registration entry for this event";
        }
        row.appendChild(label);

        // Only show Remove for ensembles that have a real entries doc (not bare ensemble stubs)
        if (!meta._unregistered) {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ghost btn--sm";
          removeBtn.textContent = "Remove";
          removeBtn.title = "Delete this registration entry (abandoned draft)";
          removeBtn.addEventListener("click", async () => {
            const eventId = state.event.active?.id;
            if (!eventId) return;
            if (!window.confirm(`Remove "${meta.schoolName} – ${meta.ensembleName}" from this event? This deletes their registration entry and cannot be undone.`)) return;
            removeBtn.disabled = true;
            removeBtn.textContent = "Removing…";
            try {
              await deleteEntry({ eventId, ensembleId });
              schedulerRegisteredEntries = schedulerRegisteredEntries.filter(
                (e) => (e.ensembleId || e.id) !== ensembleId
              );
              renderScheduleBuilderUI();
            } catch (err) {
              console.error("Failed to remove entry:", err);
              removeBtn.disabled = false;
              removeBtn.textContent = "Remove";
            }
          });
          row.appendChild(removeBtn);
        }

        unschedDiv.appendChild(row);
      }

      wrap.appendChild(unschedDiv);
    }

    // Error list
    if (errors.length) {
      const errList = document.createElement("ul");
      errList.className = "schedule-builder-errors";
      errors.forEach((msg) => {
        const li = document.createElement("li");
        li.textContent = msg;
        errList.appendChild(li);
      });
      wrap.appendChild(errList);
    }

    // Footer: Save + Reset
    const footer = document.createElement("div");
    footer.className = "schedule-builder-footer";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn--primary";
    saveBtn.textContent = "Save Schedule";
    saveBtn.disabled = errors.length > 0;
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        const { rows, firstPerformanceAt, scheduleBreaks, scheduleDayBreaks } =
          serializeSlotModel(schedulerModel, entryMeta);
        await saveSchedulerModel({ eventId: state.event.active?.id, rows, firstPerformanceAt, scheduleBreaks, scheduleDayBreaks });
        saveBtn.textContent = "Saved";
        scheduleAdminPreflightRefresh?.({ immediate: true });
        setTimeout(() => {
          saveBtn.textContent = "Save Schedule";
          saveBtn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error("Schedule Builder: save failed", err);
        saveBtn.textContent = "Save Failed";
        saveBtn.disabled = false;
      }
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "ghost btn--sm";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", async () => {
      if (!window.confirm("Reload the schedule from Firestore? Unsaved changes will be lost.")) return;
      schedulerModel = null;
      await renderScheduleBuilder();
    });

    footer.appendChild(saveBtn);
    footer.appendChild(resetBtn);
    wrap.appendChild(footer);

    container.appendChild(wrap);
  }

  return {
    renderAdminSchoolDetail,
    renderAdminLiveSubmissions,
    renderAdminRatingsView,
    renderAdminPacketsBySchedule,
    renderRegisteredEnsemblesList,
    renderScheduleBuilder,
  };
}
