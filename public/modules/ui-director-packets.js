export function createDirectorPacketRenderers({
  els,
  state,
  JUDGE_POSITIONS,
  JUDGE_POSITION_LABELS,
  STATUSES,
  FORM_TYPES,
  CAPTION_TEMPLATES,
  renderAssessmentCard,
  fetchDirectorPacketAssets,
  fetchDirectorAudioResultAsset,
  withLoading,
} = {}) {
  function isCommentsOnlySubmission(submission) {
    return Boolean(submission?.commentsOnly);
  }

  function getSubmissionRatingLabel(submission) {
    return isCommentsOnlySubmission(submission) ? "CO" : String(submission?.computedFinalRatingLabel || "").trim() || "N/A";
  }

  function getSubmissionCaptionTotalLabel(submission) {
    return isCommentsOnlySubmission(submission) ? "CO" : String(submission?.captionScoreTotal ?? 0);
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

  function normalizePacketGrade(value) {
    const text = String(value || "").trim().toUpperCase().replace(/[–—-]+/g, "/").replace(/\s+/g, "");
    return text || "";
  }

  function requiresSightForGrade(grade) {
    return !["I", "I/II"].includes(normalizePacketGrade(grade));
  }

  function renderPacketCaptionSummary(captions = {}, formType = FORM_TYPES.stage, { hideGrades = false } = {}) {
    const captionSummary = document.createElement("div");
    captionSummary.className = "caption-grid";
    const template = CAPTION_TEMPLATES[formType] || CAPTION_TEMPLATES.stage || [];
    const seen = new Set();

    template.forEach(({ key, label }) => {
      seen.add(key);
      const value = captions[key] || {};
      const row = document.createElement("div");
      row.className = "caption-row";
      const gradeDisplay = `${value.gradeLetter || ""}${value.gradeModifier || ""}`;
      const title = document.createElement("strong");
      title.textContent = label || key;
      const grade = document.createElement("div");
      grade.textContent = hideGrades ? "Grade: CO" : `Grade: ${gradeDisplay || "N/A"}`;
      const comment = document.createElement("div");
      comment.textContent = value.comment || "";
      row.appendChild(title);
      row.appendChild(grade);
      row.appendChild(comment);
      captionSummary.appendChild(row);
    });

    return captionSummary;
  }

  function getDirectorPacketAssetCacheKey(group) {
    return `${group.eventId || ""}_${group.ensembleId || ""}`;
  }

  function renderDirectorPacketAssetsSection(group, wrapper) {
    const eventId = String(group.eventId || "").trim();
    const ensembleId = String(group.ensembleId || "").trim();
    if (!eventId || !ensembleId) return;
    const key = getDirectorPacketAssetCacheKey(group);
    const section = document.createElement("div");
    section.className = "panel stack";
    const title = document.createElement("strong");
    title.textContent = "Official Results Packet Files";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent = "Generate released score sheets and audio files for this ensemble.";
    const actions = document.createElement("div");
    actions.className = "row";
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "ghost";
    loadBtn.textContent = "Generate Score Sheets";
    actions.appendChild(loadBtn);
    section.appendChild(title);
    section.appendChild(hint);
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
          "Results packet files are still generating. Try again in a moment.";
        output.appendChild(pending);
        return;
      }
      const combined = assets.combined || null;
      if (combined?.url) {
        const combinedRow = document.createElement("div");
        combinedRow.className = "row";
        const viewCombined = document.createElement("a");
        viewCombined.className = "ghost";
        viewCombined.href = combined.url;
        viewCombined.target = "_blank";
        viewCombined.rel = "noopener";
        viewCombined.textContent = "Open Full Results Packet PDF";
        const printCombined = document.createElement("a");
        printCombined.className = "ghost";
        printCombined.href = combined.url;
        printCombined.target = "_blank";
        printCombined.rel = "noopener";
        printCombined.textContent = "Print Full Results Packet PDF";
        combinedRow.appendChild(viewCombined);
        combinedRow.appendChild(printCombined);
        output.appendChild(combinedRow);
      } else {
        const combinedMissing = document.createElement("div");
        combinedMissing.className = "note";
        combinedMissing.textContent = "Combined results packet PDF is not available yet.";
        output.appendChild(combinedMissing);
      }
      const judgeAssets = assets.judges && typeof assets.judges === "object" ? assets.judges : {};
      Object.values(JUDGE_POSITIONS).forEach((position) => {
        const item = judgeAssets[position];
        if (!item) return;
        const audioSegments = Array.isArray(item.audioSegments) ? item.audioSegments : [];
        const row = document.createElement("div");
        row.className = "packet-card";
        const label = document.createElement("div");
        label.className = "badge";
        label.textContent = item.judgeLabel || JUDGE_POSITION_LABELS[position] || position;
        row.appendChild(label);
        const rowHint = document.createElement("div");
        rowHint.className = "note";
        rowHint.textContent = "Released judge files";
        row.appendChild(rowHint);
        const fileActions = document.createElement("div");
        fileActions.className = "row";
        if (item.pdfUrl) {
          const pdfView = document.createElement("a");
          pdfView.className = "ghost";
          pdfView.href = item.pdfUrl;
          pdfView.target = "_blank";
          pdfView.rel = "noopener";
          pdfView.textContent = "View Form PDF";
          const pdfDownload = document.createElement("a");
          pdfDownload.className = "ghost";
          pdfDownload.href = item.pdfUrl;
          pdfDownload.target = "_blank";
          pdfDownload.rel = "noopener";
          pdfDownload.textContent = "Download PDF";
          fileActions.appendChild(pdfView);
          fileActions.appendChild(pdfDownload);
        }
        if (item.audioUrl) {
          const audioLink = document.createElement("a");
          audioLink.className = "ghost";
          audioLink.href = item.audioUrl;
          audioLink.target = "_blank";
          audioLink.rel = "noopener";
          audioLink.download = "";
          const durationText = formatDuration(Number(item.audioDurationSec || 0));
          audioLink.textContent = durationText ? `Open Audio (${durationText})` : "Open Audio";
          fileActions.appendChild(audioLink);

          const audioDownload = document.createElement("a");
          audioDownload.className = "ghost";
          audioDownload.href = item.audioUrl;
          audioDownload.target = "_blank";
          audioDownload.rel = "noopener";
          audioDownload.download = "";
          audioDownload.textContent = "Download Audio";
          fileActions.appendChild(audioDownload);
        } else if (audioSegments.length > 1) {
          audioSegments.forEach((segment, index) => {
            if (!segment?.audioUrl) return;
            const audioLink = document.createElement("a");
            audioLink.className = "ghost";
            audioLink.href = segment.audioUrl;
            audioLink.target = "_blank";
            audioLink.rel = "noopener";
            const durationText = formatDuration(Number(segment?.durationSec || 0));
            audioLink.textContent = durationText
              ? `Open Audio Part ${index + 1} (${durationText})`
              : `Open Audio Part ${index + 1}`;
            fileActions.appendChild(audioLink);
          });
        } else if (audioSegments.length === 1 && audioSegments[0]?.audioUrl) {
          const audioLink = document.createElement("a");
          audioLink.className = "ghost";
          audioLink.href = audioSegments[0].audioUrl;
          audioLink.target = "_blank";
          audioLink.rel = "noopener";
          const durationText = formatDuration(Number(audioSegments[0]?.durationSec || 0));
          audioLink.textContent = durationText ? `Open Audio (${durationText})` : "Open Audio";
          fileActions.appendChild(audioLink);
        }
        if (item.supplementalAudioUrl) {
          const supplementalAudioLink = document.createElement("a");
          supplementalAudioLink.className = "ghost";
          supplementalAudioLink.href = item.supplementalAudioUrl;
          supplementalAudioLink.target = "_blank";
          supplementalAudioLink.rel = "noopener";
          const durationText = formatDuration(Number(item.supplementalAudioDurationSec || 0));
          supplementalAudioLink.textContent = durationText
            ? `Open Supplemental Audio (${durationText})`
            : "Open Supplemental Audio";
          fileActions.appendChild(supplementalAudioLink);
        }
        if (!item.pdfUrl && !item.audioUrl && !audioSegments.length && !item.supplementalAudioUrl) {
          const unavailable = document.createElement("div");
          unavailable.className = "note";
          unavailable.textContent = "Files are not available yet for this judge.";
          row.appendChild(unavailable);
        }
        row.appendChild(fileActions);
        output.appendChild(row);
      });
    };

    loadBtn.addEventListener("click", async () => {
      loadBtn.dataset.loadingLabel = "Loading...";
      await withLoading(loadBtn, async () => {
        const result = await fetchDirectorPacketAssets({ eventId, ensembleId });
        if (!result?.ok) {
          hint.textContent = result?.message || "Unable to generate released score sheets right now.";
          return;
        }
        state.director.packetAssetsCache.set(key, result);
        renderAssets(result);
        hint.textContent = "Released score sheets ready.";
        loadBtn.textContent = "Regenerate Score Sheets";
      });
    });

    const cached = state.director.packetAssetsCache.get(key);
    if (cached) {
      renderAssets(cached);
      hint.textContent = "Released score sheets ready.";
      loadBtn.textContent = "Regenerate Score Sheets";
    }

    wrapper.appendChild(section);
  }

  function sortDirectorScheduledGroups(groups = []) {
    return (Array.isArray(groups) ? groups : [])
      .filter((group) => String(group?.type || "") === "scheduled")
      .slice()
      .sort((a, b) => {
        const schoolCompare = String(a?.schoolName || a?.schoolId || "").localeCompare(
          String(b?.schoolName || b?.schoolId || "")
        );
        if (schoolCompare) return schoolCompare;
        return String(a?.ensembleName || a?.ensembleId || "").localeCompare(
          String(b?.ensembleName || b?.ensembleId || "")
        );
      });
  }

  function buildDirectorRatingsOverview(groups = []) {
    const releasedGroups = sortDirectorScheduledGroups(groups);
    if (!releasedGroups.length) return null;

    const extractJudgeLastName = (value) => {
      const parts = String(value || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      return parts.length ? parts[parts.length - 1] : "";
    };

    const section = document.createElement("div");
    section.className = "panel stack";
    const title = document.createElement("strong");
    title.textContent = "Ratings Overview";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent =
      "Released Results Packet ratings for your ensembles. This overview appears only after packet results have been released to you.";
    section.appendChild(title);
    section.appendChild(hint);

    const table = document.createElement("table");
    table.className = "schedule-timeline-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    const ensembleHead = document.createElement("th");
    ensembleHead.scope = "col";
    ensembleHead.textContent = "Ensemble";
    headRow.appendChild(ensembleHead);

    const gradeHead = document.createElement("th");
    gradeHead.scope = "col";
    gradeHead.className = "admin-ratings-divider";
    gradeHead.textContent = "Grade";
    headRow.appendChild(gradeHead);

    const buildPositionHead = (label, judgeName = "", className = "") => {
      const th = document.createElement("th");
      th.scope = "col";
      if (className) th.className = className;
      const span = document.createElement("span");
      span.textContent = label;
      th.appendChild(span);
      const meta = document.createElement("div");
      meta.className = "admin-ratings-header-meta";
      meta.textContent = judgeName;
      th.appendChild(meta);
      return th;
    };

    const showSightColumn = releasedGroups.some((group) => requiresSightForGrade(group?.grade));
    const positions = showSightColumn ? ["stage1", "stage2", "stage3", "sight"] : ["stage1", "stage2", "stage3"];
    positions.forEach((position, index) => {
      const match = releasedGroups.find((group) => group?.submissions?.[position]?.judgeName);
      const judgeLastName = extractJudgeLastName(match?.submissions?.[position]?.judgeName || "");
      headRow.appendChild(
        buildPositionHead(
          position === "sight" ? "SR" : `Stage ${index + 1}`,
          judgeLastName
        )
      );
    });

    const overallHead = document.createElement("th");
    overallHead.scope = "col";
    overallHead.className = "admin-ratings-divider-left";
    overallHead.textContent = "Overall Rating";
    headRow.appendChild(overallHead);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const buildSlotCell = (submission, { exempt = false } = {}) => {
      const cell = document.createElement("td");
      cell.className = "admin-ratings-slot";
      cell.textContent = exempt ? "N/A" : (submission ? getSubmissionRatingLabel(submission) : "—");
      return cell;
    };

    releasedGroups.forEach((group) => {
      const row = document.createElement("tr");
      const labelCell = document.createElement("td");
      labelCell.className = "admin-ratings-ensemble";
      labelCell.innerHTML = `<strong>${group.schoolName || group.schoolId || "School"}</strong><br>${
        group.ensembleName || group.ensembleId || "Ensemble"
      }`;
      row.appendChild(labelCell);

      const gradeCell = document.createElement("td");
      gradeCell.className = "admin-ratings-grade admin-ratings-divider";
      gradeCell.textContent = group.grade || "—";
      row.appendChild(gradeCell);

      positions.forEach((position) => {
        const exempt = position === "sight" && !requiresSightForGrade(group?.grade);
        row.appendChild(buildSlotCell(group?.submissions?.[position] || null, { exempt }));
      });

      const overallCell = document.createElement("td");
      overallCell.className = "admin-ratings-overall admin-ratings-divider-left";
      overallCell.textContent = group?.overall?.label || "—";
      row.appendChild(overallCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  function renderDirectorSubmissionDisclosure(submission, position) {
    const details = document.createElement("details");
    details.className = "panel accordion-card director-result-sheet";

    const summary = document.createElement("summary");
    const summaryShell = document.createElement("div");
    summaryShell.className = "director-result-sheet-summary";

    const title = document.createElement("strong");
    title.textContent = JUDGE_POSITION_LABELS[position] || position || "Sheet";
    summaryShell.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "note";
    const judgeName = String(submission?.judgeName || "").trim() || "Unknown judge";
    const rating = getSubmissionRatingLabel(submission);
    meta.textContent = `${judgeName} - Rating: ${rating}`;
    summaryShell.appendChild(meta);

    summary.appendChild(summaryShell);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "stack";
    body.appendChild(renderAssessmentCard(submission, position, {
      showTranscript: false,
      canonicalAudioOnly: true,
    }));

    if (submission?.supplementalAudioUrl) {
      const supplementalCard = document.createElement("div");
      supplementalCard.className = "packet-card";
      const supplementalBadge = document.createElement("div");
      supplementalBadge.className = "badge";
      supplementalBadge.textContent = `${JUDGE_POSITION_LABELS[position] || position} Supplemental Audio`;
      const durationText = formatDuration(Number(submission.supplementalAudioDurationSec || 0));
      const supplementalAudio = document.createElement("audio");
      supplementalAudio.controls = true;
      supplementalAudio.preload = "metadata";
      supplementalAudio.src = submission.supplementalAudioUrl;
      supplementalAudio.className = "audio";
      supplementalCard.appendChild(supplementalBadge);
      if (durationText) {
        const supplementalMeta = document.createElement("div");
        supplementalMeta.className = "note";
        supplementalMeta.textContent = `Duration: ${durationText}`;
        supplementalCard.appendChild(supplementalMeta);
      }
      supplementalCard.appendChild(supplementalAudio);
      body.appendChild(supplementalCard);
    }

    details.appendChild(body);
    return details;
  }

  function renderDirectorPackets(groups = []) {
    els.directorPackets.innerHTML = "";
    const releasedResultGroups = groups.filter(
      (group) => !["open-assembled", "open", "audio-only"].includes(String(group?.type || ""))
    );
    const scheduledGroups = sortDirectorScheduledGroups(releasedResultGroups);
    const nonScheduledGroups = (Array.isArray(groups) ? groups : []).filter(
      (group) => String(group?.type || "") !== "scheduled"
    );
    if (els.directorResultsContextMeta) {
      const schoolName = String(els.directorSummarySchool?.textContent || "").trim() || "No school selected";
      els.directorResultsContextMeta.textContent = `School: ${schoolName}`;
    }
    if (els.directorResultsEventMeta) {
      const eventLabel =
        releasedResultGroups[0]?.eventName ||
        state.event.list?.find((item) => item.id === state.director.selectedEventId)?.name ||
        releasedResultGroups[0]?.eventId ||
        "No event selected";
      els.directorResultsEventMeta.textContent = `Event: ${eventLabel}`;
    }
    if (els.directorResultsCountMeta) {
      els.directorResultsCountMeta.textContent = `Ensembles with results: ${releasedResultGroups.length}`;
    }
    if (els.directorEmpty) {
      els.directorEmpty.style.display = groups.length ? "none" : "block";
    }
    if (!groups.length) return;

    const overview = buildDirectorRatingsOverview(releasedResultGroups);
    if (overview) {
      els.directorPackets.appendChild(overview);
    }

    for (const group of [...nonScheduledGroups, ...scheduledGroups]) {
      const wrapper = document.createElement("div");
      wrapper.className = "packet";

      if (group.type === "open-assembled") {
        const header = document.createElement("div");
        header.className = "packet-header";
        const ensembleRow = document.createElement("div");
        const ensembleLabel = document.createElement("strong");
        ensembleLabel.textContent = "Judge Sheets:";
        ensembleRow.appendChild(ensembleLabel);
        ensembleRow.appendChild(
          document.createTextNode(` ${group.ensembleName || group.ensembleId || "Unknown ensemble"}`)
        );
        const modeRow = document.createElement("div");
        modeRow.className = "note";
        const groupMode = String(group.mode || "practice").toLowerCase();
        const modeLabel =
          groupMode === "official"
            ? "Official"
            : groupMode === "mixed"
              ? "Mixed (includes practice)"
              : "Practice (non-official)";
        modeRow.textContent = modeLabel;
        const schoolRow = document.createElement("div");
        schoolRow.className = "note";
        schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
        const eventRow = document.createElement("div");
        eventRow.className = "note";
        eventRow.textContent = `Event: ${group.eventId || "Unassigned"}`;
        const directorRow = document.createElement("div");
        directorRow.className = "note";
        directorRow.textContent = `Director: ${group.directorName || "Unknown"}`;
        const gradeRow = document.createElement("div");
        gradeRow.className = "note";
        gradeRow.textContent = `Grade: ${group.grade || "Unknown"}`;
        const overallRow = document.createElement("div");
        overallRow.className = "note";
        overallRow.textContent = `Judge Overall Rating: ${group.overall?.label || "N/A"}`;
        const scopeRow = document.createElement("div");
        scopeRow.className = "hint";
        scopeRow.textContent = "These are open judge sheets and are separate from released official results packets.";
        header.appendChild(ensembleRow);
        header.appendChild(modeRow);
        header.appendChild(schoolRow);
        header.appendChild(eventRow);
        header.appendChild(directorRow);
        header.appendChild(gradeRow);
        header.appendChild(overallRow);
        header.appendChild(scopeRow);
        if (group.hasConflicts) {
          const conflictRow = document.createElement("div");
          conflictRow.className = "note";
          conflictRow.textContent = `Conflict: duplicate result sets for ${group.conflicts.join(", ")}`;
          header.appendChild(conflictRow);
        }

        const grid = document.createElement("div");
        grid.className = "packet-grid";
        Object.values(JUDGE_POSITIONS).forEach((position) => {
          const submission = group.submissions[position];
          if (submission && submission.status === STATUSES.released) {
            grid.appendChild(renderAssessmentCard(submission, position, { showTranscript: false }));
          }
        });

        wrapper.appendChild(header);
        wrapper.appendChild(grid);
        els.directorPackets.appendChild(wrapper);
        continue;
      }

      if (group.type === "open") {
        const header = document.createElement("div");
        header.className = "packet-header";
        const ensembleRow = document.createElement("div");
        const ensembleLabel = document.createElement("strong");
        ensembleLabel.textContent = "Judge Sheet";
        ensembleRow.appendChild(ensembleLabel);
        const modeRow = document.createElement("div");
        modeRow.className = "note";
        const mode = String(group.mode || "practice").toLowerCase();
        modeRow.textContent =
          mode === "official" ?
            "Official" :
            "Practice (non-official)";
        const schoolRow = document.createElement("div");
        schoolRow.className = "note";
        schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
        const ensembleNameRow = document.createElement("div");
        ensembleNameRow.className = "note";
        ensembleNameRow.textContent = `Ensemble: ${group.ensembleName || group.ensembleId || "Unknown"}`;
        const ratingRow = document.createElement("div");
        ratingRow.className = "note";
        ratingRow.textContent = `Judge Overall Rating: ${getSubmissionRatingLabel(group)}`;
        const slotRow = document.createElement("div");
        slotRow.className = "note";
        slotRow.textContent = `Judge: ${
          JUDGE_POSITION_LABELS[group.judgePosition] ||
          (group.judgePosition ? group.judgePosition : "Unassigned")
        }`;
        const scopeRow = document.createElement("div");
        scopeRow.className = "hint";
        scopeRow.textContent = "This open judge sheet is separate from the released official results packet.";
        header.appendChild(ensembleRow);
        header.appendChild(modeRow);
        header.appendChild(schoolRow);
        header.appendChild(ensembleNameRow);
        header.appendChild(slotRow);
        header.appendChild(ratingRow);
        header.appendChild(scopeRow);

        const grid = document.createElement("div");
        grid.className = "packet-grid";
        const scoringCard = document.createElement("div");
        scoringCard.className = "packet-card";
        const scoringHeader = document.createElement("div");
        scoringHeader.className = "row";
        const scoringBadge = document.createElement("span");
        scoringBadge.className = "badge";
        scoringBadge.textContent = "Caption Summary";
        scoringHeader.appendChild(scoringBadge);

        const judgeInfo = document.createElement("div");
        judgeInfo.className = "note";
        judgeInfo.textContent =
          group.judgeName && group.judgeEmail
            ? `${group.judgeName} - ${group.judgeEmail}`
            : group.judgeName || group.judgeEmail || "Unknown judge";

        const captionSummary = renderPacketCaptionSummary(
          group.captions || {},
          group.formType || FORM_TYPES.stage,
          { hideGrades: isCommentsOnlySubmission(group) }
        );
        if (!Object.keys(group.captions || {}).length) {
          const empty = document.createElement("div");
          empty.className = "note";
          empty.textContent = "No captions available.";
          captionSummary.appendChild(empty);
        }

        const scoringFooter = document.createElement("div");
        scoringFooter.className = "note";
        scoringFooter.textContent =
          `Caption Total: ${getSubmissionCaptionTotalLabel(group)} - Judge Overall Rating: ${getSubmissionRatingLabel(group)}`;

        scoringCard.appendChild(scoringHeader);
        scoringCard.appendChild(judgeInfo);
        scoringCard.appendChild(captionSummary);
        scoringCard.appendChild(scoringFooter);
        grid.appendChild(scoringCard);

        const openAudioSegments = Array.isArray(group.audioSegments) ? group.audioSegments : [];
        if (group.latestAudioUrl) {
          const audioCard = document.createElement("div");
          audioCard.className = "packet-card";
          const audioBadge = document.createElement("div");
          audioBadge.className = "badge";
          audioBadge.textContent = "Audio";
          const durationText = formatDuration(
            Number(group.audioDurationSec || openAudioSegments[0]?.durationSec || 0)
          );
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = group.latestAudioUrl;
          audio.className = "audio";
          audioCard.appendChild(audioBadge);
          if (durationText) {
            const audioMeta = document.createElement("div");
            audioMeta.className = "note";
            audioMeta.textContent = `Duration: ${durationText}`;
            audioCard.appendChild(audioMeta);
          }
          audioCard.appendChild(audio);
          grid.appendChild(audioCard);
        } else if (openAudioSegments.length > 1) {
          const audioStackCard = document.createElement("div");
          audioStackCard.className = "packet-card";
          const audioBadge = document.createElement("div");
          audioBadge.className = "badge";
          audioBadge.textContent = `Audio (${openAudioSegments.length} parts)`;
          audioStackCard.appendChild(audioBadge);
          openAudioSegments.forEach((segment, index) => {
            const partLabel = document.createElement("div");
            partLabel.className = "note";
            partLabel.textContent = segment.label || `Part ${index + 1}`;
            const audio = document.createElement("audio");
            audio.controls = true;
            audio.preload = "metadata";
            audio.src = segment.audioUrl || "";
            audio.className = "audio";
            audioStackCard.appendChild(partLabel);
            audioStackCard.appendChild(audio);
          });
          grid.appendChild(audioStackCard);
        } else if (openAudioSegments.length === 1) {
          const audioCard = document.createElement("div");
          audioCard.className = "packet-card";
          const audioBadge = document.createElement("div");
          audioBadge.className = "badge";
          audioBadge.textContent = "Audio";
          const durationText = formatDuration(
            Number(openAudioSegments[0]?.durationSec || group.audioDurationSec || 0)
          );
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = openAudioSegments[0]?.audioUrl || "";
          audio.className = "audio";
          audioCard.appendChild(audioBadge);
          if (durationText) {
            const audioMeta = document.createElement("div");
            audioMeta.className = "note";
            audioMeta.textContent = `Duration: ${durationText}`;
            audioCard.appendChild(audioMeta);
          }
          audioCard.appendChild(audio);
          grid.appendChild(audioCard);
        }
        if (group.supplementalLatestAudioUrl) {
          const supplementalCard = document.createElement("div");
          supplementalCard.className = "packet-card";
          const supplementalBadge = document.createElement("div");
          supplementalBadge.className = "badge";
          supplementalBadge.textContent = "Supplemental Audio";
          const durationText = formatDuration(Number(group.supplementalLatestAudioDurationSec || 0));
          const supplementalAudio = document.createElement("audio");
          supplementalAudio.controls = true;
          supplementalAudio.preload = "metadata";
          supplementalAudio.src = group.supplementalLatestAudioUrl;
          supplementalAudio.className = "audio";
          supplementalCard.appendChild(supplementalBadge);
          if (durationText) {
            const supplementalMeta = document.createElement("div");
            supplementalMeta.className = "note";
            supplementalMeta.textContent = `Duration: ${durationText}`;
            supplementalCard.appendChild(supplementalMeta);
          }
          supplementalCard.appendChild(supplementalAudio);
          grid.appendChild(supplementalCard);
        }

        wrapper.appendChild(header);
        wrapper.appendChild(grid);
        els.directorPackets.appendChild(wrapper);
        continue;
      }

      if (group.type === "audio-only") {
        const header = document.createElement("div");
        header.className = "packet-header";
        const titleRow = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = "Audio-Only Result";
        titleRow.appendChild(label);
        const ensembleRow = document.createElement("div");
        ensembleRow.className = "note";
        ensembleRow.textContent = `Ensemble: ${group.ensembleName || group.ensembleId || "Unknown"}`;
        const schoolRow = document.createElement("div");
        schoolRow.className = "note";
        schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
        const eventRow = document.createElement("div");
        eventRow.className = "note";
        eventRow.textContent = `Event: ${group.eventId || "Unassigned"}`;
        const modeRow = document.createElement("div");
        modeRow.className = "note";
        modeRow.textContent =
          String(group.mode || "official").toLowerCase() === "practice" ?
            "Practice (non-official)" :
            "Official";
        const scopeRow = document.createElement("div");
        scopeRow.className = "hint";
        scopeRow.textContent = "Audio-only results do not include full caption sheets or released judge form PDFs.";
        const slotRow = document.createElement("div");
        slotRow.className = "note";
        slotRow.textContent = `Judge: ${
          JUDGE_POSITION_LABELS[group.judgePosition] ||
          group.judgePosition ||
          "Unassigned"
        }`;
        header.appendChild(titleRow);
        header.appendChild(ensembleRow);
        header.appendChild(schoolRow);
        header.appendChild(eventRow);
        header.appendChild(modeRow);
        header.appendChild(slotRow);
        header.appendChild(scopeRow);

        const card = document.createElement("div");
        card.className = "packet-card";
        const durationText = formatDuration(Number(group.durationSec || 0));
        if (durationText) {
          const durationMeta = document.createElement("div");
          durationMeta.className = "note";
          durationMeta.textContent = `Duration: ${durationText}`;
          card.appendChild(durationMeta);
        }
        const actions = document.createElement("div");
        actions.className = "row";
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "ghost";
        openBtn.textContent = "Open Audio";
        openBtn.dataset.loadingLabel = "Loading...";
        openBtn.addEventListener("click", async () => {
          await withLoading(openBtn, async () => {
            const result = await fetchDirectorAudioResultAsset({ audioResultId: group.id });
            if (!result?.ok || !result.audioUrl) {
              openBtn.textContent = "Audio Unavailable";
              return;
            }
            window.open(result.audioUrl, "_blank", "noopener");
          });
        });
        actions.appendChild(openBtn);
        card.appendChild(actions);
        wrapper.appendChild(header);
        wrapper.appendChild(card);
        els.directorPackets.appendChild(wrapper);
        continue;
      }

      const header = document.createElement("div");
      header.className = "packet-header";
      const directorName = group.directorName || "Unknown";
      const ensembleRow = document.createElement("div");
      const ensembleLabel = document.createElement("strong");
      ensembleLabel.textContent = "Ensemble:";
      ensembleRow.appendChild(ensembleLabel);
      ensembleRow.appendChild(
        document.createTextNode(` ${group.ensembleName || group.ensembleId || "Unknown"}`)
      );
      const schoolRow = document.createElement("div");
      schoolRow.className = "note";
      schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
      const directorRow = document.createElement("div");
      directorRow.className = "note";
      directorRow.textContent = `Director: ${directorName}`;
      const eventRow = document.createElement("div");
      eventRow.className = "note";
      eventRow.textContent = `Event: ${group.eventName || group.eventId || "Unassigned"}`;
      const gradeRow = document.createElement("div");
      gradeRow.className = "note";
      gradeRow.textContent = `Grade: ${group.grade || "Unknown"}`;
      const overallRow = document.createElement("div");
      overallRow.className = "note";
      overallRow.textContent = `Overall Rating: ${group.overall.label}`;
      const scopeRow = document.createElement("div");
      scopeRow.className = "hint";
      scopeRow.textContent = "Released official judge forms, audio, and results packet files for this ensemble.";
      header.appendChild(ensembleRow);
      header.appendChild(schoolRow);
      header.appendChild(directorRow);
      header.appendChild(eventRow);
      header.appendChild(gradeRow);
      header.appendChild(overallRow);
      header.appendChild(scopeRow);

      const grid = document.createElement("div");
      grid.className = "packet-grid";
      Object.values(JUDGE_POSITIONS).forEach((position) => {
        const submission = group.submissions[position];
        if (submission && submission.status === STATUSES.released) {
          grid.appendChild(renderDirectorSubmissionDisclosure(submission, position));
        }
      });

      wrapper.appendChild(header);
      wrapper.appendChild(grid);
      renderDirectorPacketAssetsSection(group, wrapper);
      els.directorPackets.appendChild(wrapper);
    }
  }

  return {
    renderDirectorPacketAssetsSection,
    renderDirectorPackets,
  };
}
