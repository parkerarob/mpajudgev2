export function createJudgeOpenCore({
  els,
  state,
  withLoading,
  getOpenCaptionTemplate,
  calculateCaptionTotal,
  computeFinalRating,
  formatPerformanceAt,
  confirmUser,
  deleteOpenSession,
  retryOpenSessionUploads,
  transcribeOpenSegment,
  setOpenPacketHint,
  updateTapePlayback,
  isOpenPacketEditable,
  hasLinkedOpenEnsemble,
  startOpenLevelMeter,
  stopOpenLevelMeter,
} = {}) {
  const runWithLoading = withLoading || (async (_button, asyncFn) => asyncFn());

  function autoSizeCaptionTextarea(textareaEl) {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = `${Math.max(textareaEl.scrollHeight, 128)}px`;
  }

  function areOpenCaptionsComplete() {
    const template = getOpenCaptionTemplate();
    return template.every(({ key }) => {
      const comment = String(state.judgeOpen.captions[key]?.comment || "").trim();
      const grade = state.judgeOpen.captions[key]?.gradeLetter;
      return Boolean(grade) && Boolean(comment);
    });
  }

  function buildOpenReadinessState() {
    const packet = state.judgeOpen.currentPacket || {};
    const template = getOpenCaptionTemplate();
    const linkedEnsemble = hasLinkedOpenEnsemble();
    const segmentCount = Number(packet.segmentCount || packet.audioSessionCount || 0);
    const hasAudio = segmentCount > 0 || (state.judgeOpen.sessions || []).length > 0;
    const hasTranscript = Boolean(String(state.judgeOpen.transcriptText || "").trim());
    const pendingUploads = state.judgeOpen.pendingUploads > 0;
    const recordingActive = state.judgeOpen.mediaRecorder?.state === "recording";
    const editable = isOpenPacketEditable(packet);
    const missingCaptionGradeCount = template.reduce((count, { key }) => {
      return count + (state.judgeOpen.captions[key]?.gradeLetter ? 0 : 1);
    }, 0);
    const missingCaptionCommentCount = template.reduce((count, { key }) => {
      return count + (String(state.judgeOpen.captions[key]?.comment || "").trim() ? 0 : 1);
    }, 0);
    const captionsComplete = template.length === 0 ? true : areOpenCaptionsComplete();
    const canSubmit =
      editable && linkedEnsemble && hasAudio && captionsComplete && !pendingUploads && !recordingActive;
    return {
      linkedEnsemble,
      hasAudio,
      hasTranscript,
      captionsComplete,
      missingCaptionCount: Math.max(missingCaptionGradeCount, missingCaptionCommentCount),
      missingCaptionGradeCount,
      missingCaptionCommentCount,
      pendingUploads,
      recordingActive,
      editable,
      canSubmit,
    };
  }

  function setJudgeOpenStepChip(el, { done = false, active = false } = {}) {
    if (!el) return;
    el.classList.toggle("is-done", Boolean(done));
    el.classList.toggle("is-active", Boolean(active));
  }

  function renderOpenReadiness() {
    const readiness = buildOpenReadinessState();
    setJudgeOpenStepChip(els.judgeOpenStepChipEnsemble, {
      done: readiness.linkedEnsemble,
      active: !readiness.linkedEnsemble,
    });
    setJudgeOpenStepChip(els.judgeOpenStepChipAudio, {
      done: readiness.hasAudio,
      active: readiness.linkedEnsemble && !readiness.hasAudio,
    });
    setJudgeOpenStepChip(els.judgeOpenStepChipTranscript, {
      done: readiness.hasTranscript,
      active: false,
    });
    setJudgeOpenStepChip(els.judgeOpenStepChipCaptions, {
      done: readiness.captionsComplete,
      active: readiness.hasAudio && !readiness.captionsComplete,
    });
    if (els.judgeOpenSubmitHint) {
      if (!state.judgeOpen.currentPacketId) {
        els.judgeOpenSubmitHint.textContent = readiness.linkedEnsemble
          ? "Start recording to create the assessment."
          : "No active assessment.";
      } else if (!readiness.linkedEnsemble) {
        els.judgeOpenSubmitHint.textContent = "Blocked: ensemble not selected.";
      } else if (!readiness.hasAudio) {
        els.judgeOpenSubmitHint.textContent = "Blocked: no recording yet.";
      } else if (!readiness.captionsComplete) {
        const parts = [];
        if (readiness.missingCaptionCommentCount > 0) {
          parts.push(`${readiness.missingCaptionCommentCount} caption comment${readiness.missingCaptionCommentCount === 1 ? "" : "s"}`);
        }
        if (readiness.missingCaptionGradeCount > 0) {
          parts.push(`${readiness.missingCaptionGradeCount} score${readiness.missingCaptionGradeCount === 1 ? "" : "s"}`);
        }
        els.judgeOpenSubmitHint.textContent = `Blocked: ${parts.join(" and ")} missing.`;
      } else if (!readiness.editable) {
        els.judgeOpenSubmitHint.textContent = "Blocked: assessment already submitted or released.";
      } else if (readiness.recordingActive) {
        els.judgeOpenSubmitHint.textContent = "Blocked: stop recording first.";
      } else if (readiness.pendingUploads) {
        els.judgeOpenSubmitHint.textContent = "Blocked: waiting for uploads.";
      } else {
        els.judgeOpenSubmitHint.textContent = "Ready to submit.";
      }
    }
    return readiness;
  }

  function updateOpenHeader() {
    if (!els.judgeOpenHeaderTitle || !els.judgeOpenHeaderSub) return;
    const packet = state.judgeOpen.currentPacket || {};
    const selectedExisting = state.judgeOpen.selectedExisting || {};
    const readiness = renderOpenReadiness();
    const school = selectedExisting.schoolName || packet.schoolName || "School";
    const ensemble = selectedExisting.ensembleName || packet.ensembleName || "Ensemble";
    const statusRaw = String(packet.status || "draft");
    const statusLabel = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : "Draft";
    const title = `${school} - ${ensemble}`;
    els.judgeOpenHeaderTitle.textContent = title;
    els.judgeOpenHeaderSub.textContent = statusLabel;
    if (els.judgeOpenSummaryTitle) {
      els.judgeOpenSummaryTitle.textContent = title;
    }
    if (els.judgeOpenSummaryStatus) {
      els.judgeOpenSummaryStatus.textContent = statusLabel;
    }
    if (els.judgeOpenSummaryMeta) {
      const formLabel = (packet.formType || state.judgeOpen.formType || "stage") === "sight"
        ? "Sight Reading"
        : "Stage";
      const segments = Number(packet.segmentCount || packet.audioSessionCount || 0);
      const mode = packet.mode === "official" ? "Official" : "Practice";
      els.judgeOpenSummaryMeta.textContent = `${mode} ${formLabel} assessment - ${segments} recording part${segments === 1 ? "" : "s"}`;
    }
  }

  function renderOpenCaptionForm() {
    if (!els.judgeOpenCaptionForm) return;
    els.judgeOpenCaptionForm.innerHTML = "";
    const template = getOpenCaptionTemplate();
    template.forEach(({ key, label }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "caption-card";
      wrapper.dataset.key = key;
      wrapper.innerHTML = `
        <div class="caption-body">
          <div class="caption-main">
            <div class="caption-header-row">
              <div class="caption-title">${label}</div>
              <div class="caption-segments" data-grade-group>
                <button type="button" data-grade="A">A</button>
                <button type="button" data-grade="B">B</button>
                <button type="button" data-grade="C">C</button>
                <button type="button" data-grade="D">D</button>
                <button type="button" data-grade="F">F</button>
              </div>
            </div>
            <textarea rows="5" data-comment class="caption-comment"></textarea>
          </div>
          <div class="caption-grade-rail">
            <div class="caption-modifiers" data-modifier-group>
              <button type="button" data-modifier="+">+</button>
              <button type="button" data-modifier="-">-</button>
            </div>
          </div>
        </div>
      `;
      els.judgeOpenCaptionForm.appendChild(wrapper);
    });
    applyOpenCaptionState();
  }

  function applyOpenCaptionState() {
    const template = getOpenCaptionTemplate();
    template.forEach(({ key }) => {
      const wrapper = els.judgeOpenCaptionForm?.querySelector(`[data-key="${key}"]`);
      if (!wrapper) return;
      const caption = state.judgeOpen.captions[key] || {};
      const comment = wrapper.querySelector("[data-comment]");
      const gradeButtons = wrapper.querySelectorAll("[data-grade]");
      gradeButtons.forEach((btn) => {
        const active = btn.dataset.grade === caption.gradeLetter;
        btn.classList.toggle("is-active", active);
      });
      const modifierButtons = wrapper.querySelectorAll("[data-modifier]");
      modifierButtons.forEach((btn) => {
        const active = btn.dataset.modifier === caption.gradeModifier;
        btn.classList.toggle("is-active", active);
      });
      if (comment) {
        comment.value = caption.comment || "";
        autoSizeCaptionTextarea(comment);
      }
    });
    const complete = areOpenCaptionsComplete();
    const total = calculateCaptionTotal(state.judgeOpen.captions);
    const rating = complete ? computeFinalRating(total) : { label: "N/A", value: null };
    if (els.judgeOpenCaptionTotal) {
      els.judgeOpenCaptionTotal.textContent = complete ? String(total) : "Incomplete";
    }
    if (els.judgeOpenFinalRating) {
      els.judgeOpenFinalRating.textContent = rating.label;
    }
  }

  function formatDuration(totalSec) {
    if (!Number.isFinite(totalSec)) return "0:00";
    const seconds = Math.max(0, Math.floor(totalSec || 0));
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function renderOpenSegments(sessions) {
    if (!els.judgeOpenSegmentsList) return;
    els.judgeOpenSegmentsList.innerHTML = "";
    const ordered = [...sessions].sort((a, b) => {
      const aTime = a.startedAt?.toMillis
        ? a.startedAt.toMillis()
        : a.createdAt?.toMillis
          ? a.createdAt.toMillis()
          : 0;
      const bTime = b.startedAt?.toMillis
        ? b.startedAt.toMillis()
        : b.createdAt?.toMillis
          ? b.createdAt.toMillis()
          : 0;
      if (aTime && bTime) return aTime - bTime;
      return 0;
    });
    const hasSegmentFailures = ordered.some((session) => {
      const transcriptStatus = String(session.transcriptStatus || "").toLowerCase();
      return Boolean(session.needsUpload) || transcriptStatus === "failed";
    });
    const hasMultipleSegments = ordered.length > 1;
    if (els.judgeOpenSegmentsDetails) {
      const hint = els.judgeOpenSegmentsDetails.querySelector(".readiness-hint");
      if (hint) {
        hint.textContent = hasSegmentFailures
          ? "One or more parts need attention"
          : hasMultipleSegments
            ? "Shown because this recording was saved in more than one part"
            : "Single recording";
      }
      els.judgeOpenSegmentsDetails.style.display =
        hasMultipleSegments || hasSegmentFailures ? "block" : "none";
      els.judgeOpenSegmentsDetails.open = hasMultipleSegments || hasSegmentFailures;
    }
    if (els.judgeOpenSegmentsHelperText) {
      els.judgeOpenSegmentsHelperText.textContent =
        hasSegmentFailures
          ? "The main audio player above should play the full assessment in order. These separate recording parts are here in case one of them needs to be retried."
          : hasMultipleSegments
            ? "The main audio player above should play the full assessment in order. These separate recording parts are here if you want to review one section by itself."
            : "";
      els.judgeOpenSegmentsHelperText.style.display =
        hasMultipleSegments || hasSegmentFailures ? "block" : "none";
    }
    if (els.judgeOpenSegmentsSummary) {
      els.judgeOpenSegmentsSummary.textContent = `Recording Parts (${ordered.length})`;
    }
    const orderedSessionIds = new Set(ordered.map((session) => session.id));
    if (!orderedSessionIds.has(state.judgeOpen.loadedSegmentAudioSessionId)) {
      state.judgeOpen.loadedSegmentAudioSessionId = null;
    }
    if (!hasSegmentFailures) {
      state.judgeOpen.loadedSegmentAudioSessionId = null;
    }
    ordered.forEach((session, index) => {
      const item = document.createElement("li");
      item.className = "list-item";
      const status = session.status || "recording";
      const meta = document.createElement("div");
      meta.className = "stack";
      const title = document.createElement("strong");
      title.textContent = `Part ${index + 1}`;
      const hint = document.createElement("div");
      hint.className = "note";
      const duration = formatDuration(Number(session.durationSec || 0));
      const transcriptStatus = session.transcriptStatus || "idle";
      const startedAtLabel = session.startedAt ? formatPerformanceAt(session.startedAt) : "";
      const detailParts = [`Length ${duration}`];
      if (startedAtLabel) {
        detailParts.push(startedAtLabel);
      }
      if (status === "completed") {
        detailParts.push("Saved");
      } else if (status === "recording") {
        detailParts.push("Still recording");
      } else if (status) {
        detailParts.push(status);
      }
      if (transcriptStatus === "complete") {
        detailParts.push("Auto transcript ready");
      } else if (transcriptStatus === "running") {
        detailParts.push("Auto transcript in progress");
      } else if (transcriptStatus === "failed") {
        detailParts.push("Auto transcript needs retry");
      }
      if (session.needsUpload) {
        detailParts.push("Upload needs retry");
      }
      hint.textContent = detailParts.join(" • ");
      meta.appendChild(title);
      meta.appendChild(hint);
      item.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "actions";
      if (session.needsUpload) {
        const retryBtn = document.createElement("button");
        retryBtn.className = "ghost";
        retryBtn.textContent = "Retry Upload";
        retryBtn.dataset.loadingLabel = "Retrying...";
        retryBtn.dataset.spinner = "true";
        retryBtn.addEventListener("click", async () => {
          if (retryBtn.dataset.loading === "true") return;
          await runWithLoading(retryBtn, async () => {
            setOpenPacketHint("Retrying audio upload...");
            const result = await retryOpenSessionUploads(session.id);
            if (!result?.ok) {
              setOpenPacketHint(result?.message || "Retry failed.");
              return;
            }
            setOpenPacketHint("Upload retry completed.");
          });
        });
        actions.appendChild(retryBtn);
      }
      const retryTranscriptBtn = document.createElement("button");
      retryTranscriptBtn.className = "ghost";
      retryTranscriptBtn.textContent = "Retry Auto Transcript";
      retryTranscriptBtn.dataset.loadingLabel = "Transcribing...";
      retryTranscriptBtn.dataset.spinner = "true";
      retryTranscriptBtn.addEventListener("click", async () => {
        if (retryTranscriptBtn.dataset.loading === "true") return;
        await runWithLoading(retryTranscriptBtn, async () => {
            setOpenPacketHint("Refreshing auto transcript for this recording part...");
            const result = await transcribeOpenSegment({ sessionId: session.id });
            if (!result?.ok) {
              setOpenPacketHint(result?.message || "Auto transcript refresh failed for this recording part.");
              return;
            }
          setOpenPacketHint("Auto transcript refreshed for this recording part.");
        });
      });
      actions.appendChild(retryTranscriptBtn);

      if (session.masterAudioUrl) {
        const isLoaded = state.judgeOpen.loadedSegmentAudioSessionId === session.id;
        const loadAudioBtn = document.createElement("button");
        loadAudioBtn.className = "ghost";
        loadAudioBtn.textContent = isLoaded ? "Unload Audio" : "Load Audio";
        loadAudioBtn.addEventListener("click", () => {
          state.judgeOpen.loadedSegmentAudioSessionId = isLoaded ? null : session.id;
          renderOpenSegments(state.judgeOpen.sessions || []);
        });
        actions.appendChild(loadAudioBtn);
      }
      if (session.masterAudioUrl && isOpenPacketEditable(state.judgeOpen.currentPacket || {})) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "ghost";
        deleteBtn.textContent = "Delete";
        deleteBtn.dataset.loadingLabel = "Deleting...";
        deleteBtn.dataset.spinner = "true";
        deleteBtn.addEventListener("click", async () => {
          if (deleteBtn.dataset.loading === "true") return;
          if (state.judgeOpen.mediaRecorder?.state === "recording") {
            setOpenPacketHint("Stop recording before deleting a recording part.");
            return;
          }
          const ok = confirmUser(
            `Delete Part ${index + 1}? This removes the saved recording for this part.`
          );
          if (!ok) return;
          await runWithLoading(deleteBtn, async () => {
            setOpenPacketHint(`Deleting Part ${index + 1}...`);
            const result = await deleteOpenSession({ sessionId: session.id });
            if (!result?.ok) {
              setOpenPacketHint(result?.message || "Unable to delete recording.");
              return;
            }
            setOpenPacketHint(`Deleted Part ${index + 1}.`);
          });
        });
        actions.appendChild(deleteBtn);
      }
      item.appendChild(actions);

      if (
        session.masterAudioUrl &&
        state.judgeOpen.loadedSegmentAudioSessionId === session.id
      ) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = session.masterAudioUrl;
        audio.className = "audio";
        item.appendChild(audio);
      }

      els.judgeOpenSegmentsList.appendChild(item);
    });
    updateTapePlayback(ordered);
  }

  function updateOpenSubmitState() {
    const readiness = renderOpenReadiness();
    const editable = readiness.editable;
    const canSubmit = readiness.canSubmit;
    if (els.judgeOpenSubmitBtn) {
      const submitLoading = els.judgeOpenSubmitBtn.dataset.loading === "true";
      els.judgeOpenSubmitBtn.disabled = !canSubmit || submitLoading;
    }
    if (els.judgeOpenTranscriptInput) {
      els.judgeOpenTranscriptInput.disabled = !editable;
    }
    if (els.judgeOpenDraftBtn) {
      els.judgeOpenDraftBtn.disabled = !editable;
    }
    if (els.judgeOpenTranscribeBtn) {
      els.judgeOpenTranscribeBtn.disabled = !editable;
    }
    if (els.judgeOpenRecordBtn) {
      els.judgeOpenRecordBtn.disabled = !editable;
    }
    if (els.judgeOpenStopBtn) {
      els.judgeOpenStopBtn.disabled = !editable;
    }
    const micControlsDisabled = !editable || readiness.recordingActive;
    if (els.judgeOpenMicSelect) {
      els.judgeOpenMicSelect.disabled = micControlsDisabled;
    }
    if (els.judgeOpenMicRefreshBtn) {
      els.judgeOpenMicRefreshBtn.disabled = micControlsDisabled;
    }
  }

  function updateOpenRecordingStatus() {
    if (!els.judgeOpenRecordingStatus) return;
    const hasPacket = Boolean(state.judgeOpen.currentPacketId);
    const recorder = state.judgeOpen.mediaRecorder;
    const recordingActive = Boolean(recorder && recorder.state === "recording");
    document.body.classList.toggle("judge-open-recording-safe", recordingActive);
    if (recordingActive) {
      els.judgeOpenRecordingStatus.textContent = "Recording...";
      els.judgeOpenRecordingStatus.classList.add("recording-active");
      if (els.judgeOpenEmergencyStopBtn) {
        els.judgeOpenEmergencyStopBtn.classList.remove("is-hidden");
        els.judgeOpenEmergencyStopBtn.disabled = false;
      }
      if (els.judgeOpenRecordDot) {
        els.judgeOpenRecordDot.classList.add("is-active");
      }
      if (els.judgeOpenRecordLabel) {
        els.judgeOpenRecordLabel.textContent = "Recording...";
      }
      if (els.judgeOpenRecordBtn) {
        els.judgeOpenRecordBtn.classList.add("is-recording");
      }
      if (els.judgeOpenRecordBtn) els.judgeOpenRecordBtn.disabled = true;
      if (els.judgeOpenStopBtn) els.judgeOpenStopBtn.disabled = false;
      startOpenLevelMeter(recorder.stream);
      updateOpenSubmitState();
      return;
    }
    els.judgeOpenRecordingStatus.classList.remove("recording-active");
    if (els.judgeOpenEmergencyStopBtn) {
      els.judgeOpenEmergencyStopBtn.classList.add("is-hidden");
      els.judgeOpenEmergencyStopBtn.disabled = true;
    }
    if (els.judgeOpenRecordDot) {
      els.judgeOpenRecordDot.classList.remove("is-active");
    }
    if (els.judgeOpenRecordLabel) {
      els.judgeOpenRecordLabel.textContent = "Start Recording";
    }
    if (els.judgeOpenRecordBtn) {
      els.judgeOpenRecordBtn.classList.remove("is-recording");
    }
    stopOpenLevelMeter();
    const pendingUploads = Number(state.judgeOpen.pendingUploads || 0);
    const cooldownRemainingMs = Number(state.judgeOpen.recordingCooldownUntil || 0) - Date.now();
    if (!hasPacket) {
      els.judgeOpenRecordingStatus.textContent = "";
    } else if (pendingUploads > 0) {
      const plural = pendingUploads === 1 ? "" : "s";
      els.judgeOpenRecordingStatus.textContent = `Uploading ${pendingUploads} chunk${plural}...`;
    } else if (cooldownRemainingMs > 0) {
      const waitSeconds = Math.max(1, Math.ceil(cooldownRemainingMs / 1000));
      els.judgeOpenRecordingStatus.textContent = `Finalizing microphone... ready in ${waitSeconds}s.`;
    } else if (state.judgeOpen.autoTranscriptStatusText) {
      els.judgeOpenRecordingStatus.textContent = state.judgeOpen.autoTranscriptStatusText;
    } else {
      els.judgeOpenRecordingStatus.textContent = "Ready to record.";
    }
    if (els.judgeOpenStickyAudioDuration) {
      els.judgeOpenStickyAudioDuration.textContent =
        els.judgeOpenTapeDuration?.textContent || "0:00";
    }
    if (els.judgeOpenRecordBtn) els.judgeOpenRecordBtn.disabled = false;
    if (els.judgeOpenStopBtn) els.judgeOpenStopBtn.disabled = true;
    updateOpenSubmitState();
  }

  return {
    updateOpenHeader,
    renderOpenCaptionForm,
    applyOpenCaptionState,
    renderOpenSegments,
    updateOpenSubmitState,
    updateOpenRecordingStatus,
    areOpenCaptionsComplete,
  };
}
