export function createDirectorPacketRenderers({
  els,
  state,
  JUDGE_POSITIONS,
  JUDGE_POSITION_LABELS,
  STATUSES,
  FORM_TYPES,
  CAPTION_TEMPLATES,
  renderSubmissionCard,
  fetchDirectorPacketAssets,
  withLoading,
} = {}) {
  function renderPacketCaptionSummary(captions = {}, formType = FORM_TYPES.stage) {
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
      grade.textContent = `Grade: ${gradeDisplay || "N/A"}`;
      const comment = document.createElement("div");
      comment.textContent = value.comment || "";
      row.appendChild(title);
      row.appendChild(grade);
      row.appendChild(comment);
      captionSummary.appendChild(row);
    });

    Object.entries(captions).forEach(([key, value]) => {
      if (seen.has(key)) return;
      const row = document.createElement("div");
      row.className = "caption-row";
      const gradeDisplay = `${value?.gradeLetter || ""}${value?.gradeModifier || ""}`;
      const title = document.createElement("strong");
      title.textContent = key;
      const grade = document.createElement("div");
      grade.textContent = `Grade: ${gradeDisplay || "N/A"}`;
      const comment = document.createElement("div");
      comment.textContent = value?.comment || "";
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
    title.textContent = "Official Packet Files";
    const hint = document.createElement("div");
    hint.className = "note";
    hint.textContent = "Load downloadable/printable PDF forms and audio files for each judge.";
    const actions = document.createElement("div");
    actions.className = "row";
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "ghost";
    loadBtn.textContent = "Load Files";
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
          "Packet files are still generating. Try again in a moment.";
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
        viewCombined.textContent = "View Full Packet PDF";
        const printCombined = document.createElement("a");
        printCombined.className = "ghost";
        printCombined.href = combined.url;
        printCombined.target = "_blank";
        printCombined.rel = "noopener";
        printCombined.textContent = "Print Full Packet PDF";
        combinedRow.appendChild(viewCombined);
        combinedRow.appendChild(printCombined);
        output.appendChild(combinedRow);
      } else {
        const combinedMissing = document.createElement("div");
        combinedMissing.className = "note";
        combinedMissing.textContent = "Combined packet PDF is not available yet.";
        output.appendChild(combinedMissing);
      }
      const judgeAssets = assets.judges && typeof assets.judges === "object" ? assets.judges : {};
      Object.values(JUDGE_POSITIONS).forEach((position) => {
        const item = judgeAssets[position];
        if (!item) return;
        const row = document.createElement("div");
        row.className = "packet-card";
        const label = document.createElement("div");
        label.className = "badge";
        label.textContent = item.judgeLabel || JUDGE_POSITION_LABELS[position] || position;
        row.appendChild(label);
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
          audioLink.textContent = "Open Audio";
          fileActions.appendChild(audioLink);
        }
        if (!item.pdfUrl && !item.audioUrl) {
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
          hint.textContent = result?.message || "Unable to load packet files.";
          return;
        }
        state.director.packetAssetsCache.set(key, result);
        renderAssets(result);
        hint.textContent = "Official packet files loaded.";
        loadBtn.textContent = "Refresh Files";
      });
    });

    const cached = state.director.packetAssetsCache.get(key);
    if (cached) {
      renderAssets(cached);
      loadBtn.textContent = "Refresh Files";
    }

    wrapper.appendChild(section);
  }

  function renderDirectorPackets(groups = []) {
    els.directorPackets.innerHTML = "";
    if (els.directorEmpty) {
      els.directorEmpty.style.display = groups.length ? "none" : "block";
    }
    if (!groups.length) return;

    for (const group of groups) {
      const wrapper = document.createElement("div");
      wrapper.className = "packet";

      if (group.type === "open-assembled") {
        const header = document.createElement("div");
        header.className = "packet-header";
        const ensembleRow = document.createElement("div");
        const ensembleLabel = document.createElement("strong");
        ensembleLabel.textContent = "Open Judge Packet Set:";
        ensembleRow.appendChild(ensembleLabel);
        ensembleRow.appendChild(
          document.createTextNode(` ${group.ensembleName || group.ensembleId || "Unknown ensemble"}`)
        );
        const modeRow = document.createElement("div");
        modeRow.className = "note";
        const groupMode = String(group.mode || "practice").toLowerCase();
        const modeLabel =
          groupMode === "official"
            ? "Official adjudication"
            : groupMode === "mixed"
              ? "Mixed adjudication modes (includes practice)"
              : "Practice adjudication (non-official)";
        modeRow.textContent = `Mode: ${modeLabel}`;
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
        overallRow.textContent = `Overall: ${group.overall?.label || "N/A"}`;
        header.appendChild(ensembleRow);
        header.appendChild(modeRow);
        header.appendChild(schoolRow);
        header.appendChild(eventRow);
        header.appendChild(directorRow);
        header.appendChild(gradeRow);
        header.appendChild(overallRow);
        if (group.hasConflicts) {
          const conflictRow = document.createElement("div");
          conflictRow.className = "note";
          conflictRow.textContent = `Conflict: duplicate packet(s) for ${group.conflicts.join(", ")}`;
          header.appendChild(conflictRow);
        }

        const grid = document.createElement("div");
        grid.className = "packet-grid";
        Object.values(JUDGE_POSITIONS).forEach((position) => {
          const submission = group.submissions[position];
          if (submission && submission.status === STATUSES.released) {
            grid.appendChild(renderSubmissionCard(submission, position, { showTranscript: false }));
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
        ensembleLabel.textContent = "Open Packet";
        ensembleRow.appendChild(ensembleLabel);
        const modeRow = document.createElement("div");
        modeRow.className = "note";
        const mode = String(group.mode || "practice").toLowerCase();
        modeRow.textContent =
          mode === "official" ?
            "Mode: Official adjudication" :
            "Mode: Practice adjudication (non-official)";
        const schoolRow = document.createElement("div");
        schoolRow.className = "note";
        schoolRow.textContent = `School: ${group.schoolName || group.schoolId || "Unknown"}`;
        const ensembleNameRow = document.createElement("div");
        ensembleNameRow.className = "note";
        ensembleNameRow.textContent = `Ensemble: ${group.ensembleName || group.ensembleId || "Unknown"}`;
        const ratingRow = document.createElement("div");
        ratingRow.className = "note";
        ratingRow.textContent = `Final Rating: ${group.computedFinalRatingLabel || "N/A"}`;
        const slotRow = document.createElement("div");
        slotRow.className = "note";
        slotRow.textContent = `Slot: ${
          JUDGE_POSITION_LABELS[group.judgePosition] ||
          (group.judgePosition ? group.judgePosition : "Unassigned")
        }`;
        header.appendChild(ensembleRow);
        header.appendChild(modeRow);
        header.appendChild(schoolRow);
        header.appendChild(ensembleNameRow);
        header.appendChild(slotRow);
        header.appendChild(ratingRow);

        const grid = document.createElement("div");
        grid.className = "packet-grid";
        const scoringCard = document.createElement("div");
        scoringCard.className = "packet-card";
        const scoringHeader = document.createElement("div");
        scoringHeader.className = "row";
        const scoringBadge = document.createElement("span");
        scoringBadge.className = "badge";
        scoringBadge.textContent = "Judge";
        const scoringStatus = document.createElement("span");
        scoringStatus.className = "note";
        scoringStatus.textContent = `Status: ${group.status || "released"}`;
        const scoringLocked = document.createElement("span");
        scoringLocked.className = "note";
        scoringLocked.textContent = `Locked: ${group.locked ? "yes" : "no"}`;
        scoringHeader.appendChild(scoringBadge);
        scoringHeader.appendChild(scoringStatus);
        scoringHeader.appendChild(scoringLocked);

        const judgeInfo = document.createElement("div");
        judgeInfo.className = "note";
        judgeInfo.textContent =
          group.judgeName && group.judgeEmail
            ? `${group.judgeName} - ${group.judgeEmail}`
            : group.judgeName || group.judgeEmail || "Unknown judge";

        const captionSummary = renderPacketCaptionSummary(
          group.captions || {},
          group.formType || FORM_TYPES.stage
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
          `Caption Total: ${group.captionScoreTotal || 0} - Final Rating: ${group.computedFinalRatingLabel || "N/A"}`;

        scoringCard.appendChild(scoringHeader);
        scoringCard.appendChild(judgeInfo);
        scoringCard.appendChild(captionSummary);
        scoringCard.appendChild(scoringFooter);
        grid.appendChild(scoringCard);

        if (group.latestAudioUrl) {
          const audioCard = document.createElement("div");
          audioCard.className = "packet-card";
          const audioBadge = document.createElement("div");
          audioBadge.className = "badge";
          audioBadge.textContent = "Audio";
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = group.latestAudioUrl;
          audio.className = "audio";
          audioCard.appendChild(audioBadge);
          audioCard.appendChild(audio);
          grid.appendChild(audioCard);
        }

        wrapper.appendChild(header);
        wrapper.appendChild(grid);
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
      ensembleRow.appendChild(document.createTextNode(` ${group.ensembleId}`));
      const schoolRow = document.createElement("div");
      schoolRow.className = "note";
      schoolRow.textContent = `School: ${group.schoolId}`;
      const directorRow = document.createElement("div");
      directorRow.className = "note";
      directorRow.textContent = `Director: ${directorName}`;
      const eventRow = document.createElement("div");
      eventRow.className = "note";
      eventRow.textContent = `Event: ${group.eventId}`;
      const gradeRow = document.createElement("div");
      gradeRow.className = "note";
      gradeRow.textContent = `Grade: ${group.grade || "Unknown"}`;
      const overallRow = document.createElement("div");
      overallRow.className = "note";
      overallRow.textContent = `Overall: ${group.overall.label}`;
      header.appendChild(ensembleRow);
      header.appendChild(schoolRow);
      header.appendChild(directorRow);
      header.appendChild(eventRow);
      header.appendChild(gradeRow);
      header.appendChild(overallRow);

      const grid = document.createElement("div");
      grid.className = "packet-grid";
      Object.values(JUDGE_POSITIONS).forEach((position) => {
        const submission = group.submissions[position];
        if (submission && submission.status === STATUSES.released) {
          grid.appendChild(renderSubmissionCard(submission, position, { showTranscript: false }));
        }
      });

      const siteRatingCard = document.createElement("div");
      siteRatingCard.className = "packet-card";
      const siteBadge = document.createElement("div");
      siteBadge.className = "badge";
      siteBadge.textContent = "Site Rating";
      const siteNote = document.createElement("div");
      siteNote.className = "note";
      siteNote.textContent = "Site rating details coming soon.";
      siteRatingCard.appendChild(siteBadge);
      siteRatingCard.appendChild(siteNote);
      grid.appendChild(siteRatingCard);

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
