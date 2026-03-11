export function createJudgeOpenCore({
  els,
  state,
  withLoading,
  getOpenCaptionTemplate,
  calculateCaptionTotal,
  computeFinalRating,
  formatPerformanceAt,
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
      const grade = state.judgeOpen.captions[key]?.gradeLetter;
      return Boolean(grade);
    });
  }

  function buildOpenReadinessState() {
    const packet = state.judgeOpen.currentPacket || {};
    const template = getOpenCaptionTemplate();
    const missingCaptionCount = template.reduce((count, { key }) => {
      return count + (state.judgeOpen.captions[key]?.gradeLetter ? 0 : 1);
    }, 0);
    const linkedEnsemble = hasLinkedOpenEnsemble();
    const segmentCount = Number(packet.segmentCount || packet.audioSessionCount || 0);
    const hasAudio = segmentCount > 0 || (state.judgeOpen.sessions || []).length > 0;
    const hasTranscript = Boolean(String(state.judgeOpen.transcriptText || "").trim());
    const captionsComplete = missingCaptionCount === 0;
    const pendingUploads = state.judgeOpen.pendingUploads > 0;
    const recordingActive = state.judgeOpen.mediaRecorder?.state === "recording";
    const editable = isOpenPacketEditable(packet);
    const canSubmit =
      editable && captionsComplete && linkedEnsemble && !pendingUploads && !recordingActive;
    return {
      linkedEnsemble,
      hasAudio,
      hasTranscript,
      captionsComplete,
      missingCaptionCount,
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
      active: readiness.hasAudio && !readiness.hasTranscript,
    });
    setJudgeOpenStepChip(els.judgeOpenStepChipCaptions, {
      done: readiness.captionsComplete,
      active: readiness.hasTranscript && !readiness.captionsComplete,
    });
    if (els.judgeOpenReadinessHint) {
      if (!state.judgeOpen.currentPacketId) {
        els.judgeOpenReadinessHint.textContent = "Create or select an adjudication to begin.";
      } else if (!readiness.linkedEnsemble) {
        els.judgeOpenReadinessHint.textContent = "Select an existing school and ensemble.";
      } else if (!readiness.hasAudio) {
        els.judgeOpenReadinessHint.textContent = "Record audio.";
      } else if (!readiness.hasTranscript) {
        els.judgeOpenReadinessHint.textContent = "Transcript is generated automatically after recording.";
      } else if (!readiness.captionsComplete) {
        els.judgeOpenReadinessHint.textContent = `${readiness.missingCaptionCount} caption grade(s) still missing.`;
      } else if (!readiness.editable) {
        els.judgeOpenReadinessHint.textContent = "Adjudication is locked and can no longer be edited.";
      } else if (readiness.recordingActive) {
        els.judgeOpenReadinessHint.textContent = "Stop recording to continue.";
      } else if (readiness.pendingUploads) {
        els.judgeOpenReadinessHint.textContent = "Waiting for audio uploads to finish.";
      } else {
        els.judgeOpenReadinessHint.textContent = "Ready to submit.";
      }
    }
    if (els.judgeOpenSubmitHint) {
      if (!state.judgeOpen.currentPacketId) {
        els.judgeOpenSubmitHint.textContent = "No active adjudication.";
      } else if (!readiness.linkedEnsemble) {
        els.judgeOpenSubmitHint.textContent = "Blocked: ensemble not selected.";
      } else if (!readiness.captionsComplete) {
        els.judgeOpenSubmitHint.textContent =
          `Blocked: ${readiness.missingCaptionCount} caption grade(s) missing.`;
      } else if (!readiness.editable) {
        els.judgeOpenSubmitHint.textContent = "Blocked: adjudication already submitted or released.";
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
      els.judgeOpenSummaryMeta.textContent = `${mode} ${formLabel} adjudication - ${segments} recording part${segments === 1 ? "" : "s"}`;
    }
    if (els.judgeOpenSummaryHint) {
      if (!state.judgeOpen.currentPacketId) {
        els.judgeOpenSummaryHint.textContent = "Create or select an adjudication to begin.";
      } else if (statusRaw === "released") {
        els.judgeOpenSummaryHint.textContent = "This adjudication has been released.";
      } else if (statusRaw === "submitted" || statusRaw === "locked") {
        els.judgeOpenSummaryHint.textContent = "Adjudication is submitted and locked.";
      } else {
        els.judgeOpenSummaryHint.textContent = "Complete the steps below, then submit the adjudication.";
      }
    }
    renderOpenReadiness();
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
          ? "The main audio player above should play the full adjudication in order. These separate recording parts are here in case one of them needs to be retried."
          : hasMultipleSegments
            ? "The main audio player above should play the full adjudication in order. These separate recording parts are here if you want to review one section by itself."
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
        detailParts.push("Transcript ready");
      } else if (transcriptStatus === "running") {
        detailParts.push("Transcript in progress");
      } else if (transcriptStatus === "failed") {
        detailParts.push("Transcript needs retry");
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
      retryTranscriptBtn.textContent = "Retry Transcription";
      retryTranscriptBtn.dataset.loadingLabel = "Transcribing...";
      retryTranscriptBtn.dataset.spinner = "true";
      retryTranscriptBtn.addEventListener("click", async () => {
        if (retryTranscriptBtn.dataset.loading === "true") return;
        await runWithLoading(retryTranscriptBtn, async () => {
          setOpenPacketHint("Transcribing segment...");
          const result = await transcribeOpenSegment({ sessionId: session.id });
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Segment transcription failed.");
            return;
          }
          setOpenPacketHint("Segment transcription complete.");
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
  }

  function updateOpenRecordingStatus() {
    if (!els.judgeOpenRecordingStatus) return;
    const hasPacket = Boolean(state.judgeOpen.currentPacketId);
    const setMicDebug = () => {
      if (!els.judgeOpenMicSettingsDebug) return;
      const s = state.judgeOpen.micTrackSettings;
      if (!s) {
        els.judgeOpenMicSettingsDebug.textContent = "";
        return;
      }
      const ec = s.echoCancellation;
      const ns = s.noiseSuppression;
      const agc = s.autoGainControl;
      els.judgeOpenMicSettingsDebug.textContent =
        `Mic settings: EC=${String(ec)} - NS=${String(ns)} - AGC=${String(agc)}`;
    };
    const recorder = state.judgeOpen.mediaRecorder;
    if (recorder && recorder.state === "recording") {
      els.judgeOpenRecordingStatus.textContent = "Recording...";
      els.judgeOpenRecordingStatus.classList.add("recording-active");
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
      setMicDebug();
      updateOpenSubmitState();
      return;
    }
    els.judgeOpenRecordingStatus.classList.remove("recording-active");
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
    if (!hasPacket) {
      els.judgeOpenRecordingStatus.textContent = "Choose an ensemble and start a draft adjudication.";
    } else if (pendingUploads > 0) {
      const plural = pendingUploads === 1 ? "" : "s";
      els.judgeOpenRecordingStatus.textContent = `Uploading ${pendingUploads} chunk${plural}...`;
    } else if (state.judgeOpen.autoTranscriptStatusText) {
      els.judgeOpenRecordingStatus.textContent = state.judgeOpen.autoTranscriptStatusText;
    } else {
      els.judgeOpenRecordingStatus.textContent = "Ready to record.";
    }
    setMicDebug();
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
