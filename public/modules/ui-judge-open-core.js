export function createJudgeOpenCore({
  els,
  state,
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
  function areOpenCaptionsComplete() {
    const template = getOpenCaptionTemplate();
    return template.every(({ key }) => {
      const grade = state.judgeOpen.captions[key]?.gradeLetter;
      return Boolean(grade);
    });
  }

  function updateOpenHeader() {
    if (!els.judgeOpenHeaderTitle || !els.judgeOpenHeaderSub) return;
    const packet = state.judgeOpen.currentPacket || {};
    const school = packet.schoolName || "School";
    const ensemble = packet.ensembleName || "Ensemble";
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
      els.judgeOpenSummaryMeta.textContent = `${formLabel} packet - ${segments} segment${segments === 1 ? "" : "s"}`;
    }
    if (els.judgeOpenSummaryHint) {
      if (!state.judgeOpen.currentPacketId) {
        els.judgeOpenSummaryHint.textContent = "Create or select a packet to begin.";
      } else if (statusRaw === "released") {
        els.judgeOpenSummaryHint.textContent = "This packet has been released.";
      } else if (statusRaw === "submitted" || statusRaw === "locked") {
        els.judgeOpenSummaryHint.textContent = "Packet is submitted and locked.";
      } else {
        els.judgeOpenSummaryHint.textContent = "Complete the steps below, then submit the packet.";
      }
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
            <textarea rows="2" data-comment></textarea>
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
      if (comment) comment.value = caption.comment || "";
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
    if (els.judgeOpenSegmentsDetails) {
      const hint = els.judgeOpenSegmentsDetails.querySelector(".readiness-hint");
      if (hint) hint.textContent = `${ordered.length} segments`;
    }
    if (els.judgeOpenSegmentsSummary) {
      els.judgeOpenSegmentsSummary.textContent = `Segments (${ordered.length})`;
    }
    ordered.forEach((session, index) => {
      const item = document.createElement("li");
      item.className = "list-item";
      const status = session.status || "recording";
      const meta = document.createElement("div");
      meta.className = "stack";
      const title = document.createElement("strong");
      title.textContent = `Segment ${index + 1}`;
      const hint = document.createElement("div");
      hint.className = "note";
      const duration = formatDuration(Number(session.durationSec || 0));
      const transcriptStatus = session.transcriptStatus || "idle";
      const startedAtLabel = session.startedAt ? formatPerformanceAt(session.startedAt) : "";
      const startedText = startedAtLabel ? ` - ${startedAtLabel}` : "";
      hint.textContent = `${status} - ${duration}${startedText} - transcript ${transcriptStatus}${
        session.needsUpload ? " - needs upload" : ""
      }`;
      meta.appendChild(title);
      meta.appendChild(hint);
      item.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "actions";
      if (session.needsUpload) {
        const retryBtn = document.createElement("button");
        retryBtn.className = "ghost";
        retryBtn.textContent = "Retry Upload";
        retryBtn.addEventListener("click", async () => {
          const result = await retryOpenSessionUploads(session.id);
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Retry failed.");
          } else {
            setOpenPacketHint("Retry completed.");
          }
        });
        actions.appendChild(retryBtn);
      }
      const retryTranscriptBtn = document.createElement("button");
      retryTranscriptBtn.className = "ghost";
      retryTranscriptBtn.textContent = "Retry Transcription";
      retryTranscriptBtn.addEventListener("click", async () => {
        const result = await transcribeOpenSegment({ sessionId: session.id });
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Segment transcription failed.");
        } else {
          setOpenPacketHint("Segment transcription complete.");
        }
      });
      actions.appendChild(retryTranscriptBtn);
      item.appendChild(actions);

      if (session.masterAudioUrl) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = session.masterAudioUrl;
        audio.className = "audio";
        item.appendChild(audio);
      }

      els.judgeOpenSegmentsList.appendChild(item);
    });
    updateTapePlayback(ordered);
  }

  function updateOpenSubmitState() {
    const packet = state.judgeOpen.currentPacket || {};
    const editable = isOpenPacketEditable(packet);
    const complete = areOpenCaptionsComplete();
    const linkedEnsemble = hasLinkedOpenEnsemble();
    const pendingUploads = state.judgeOpen.pendingUploads > 0;
    const recordingActive = state.judgeOpen.mediaRecorder?.state === "recording";
    const canSubmit =
      editable && complete && linkedEnsemble && !pendingUploads && !recordingActive;
    if (els.judgeOpenSubmitBtn) {
      els.judgeOpenSubmitBtn.disabled = !canSubmit;
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
    if (state.judgeOpen.pendingUploads > 0) {
      els.judgeOpenRecordingStatus.textContent = "Saving chunks...";
    } else {
      els.judgeOpenRecordingStatus.textContent = "Recording saved.";
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
