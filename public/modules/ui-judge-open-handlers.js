export function createJudgeOpenHandlerBinder({
  els,
  state,
  hideOpenDetailView,
  openJudgeOpenPacket,
  hasLinkedOpenEnsemble,
  setOpenPacketHint,
  withLoading,
  gatherOpenPacketMeta,
  createOpenPacket,
  renderOpenSegments,
  saveOpenPrefsToServer,
  renderOpenCaptionForm,
  updateOpenHeader,
  showOpenDetailView,
  updateOpenEmptyState,
  updateOpenSubmitState,
  saveOpenPrefs,
  setJudgeOpenDirectorReferenceState,
  renderJudgeOpenDirectorReference,
  syncOpenEventDefaultsUI,
  refreshOpenEventDefaultsState,
  getOpenEventDefaultsPreference,
  markJudgeOpenDirty,
  buildOpenEnsembleSnapshot,
  updateOpenPacketDraft,
  refreshJudgeOpenDirectorReference,
  syncOpenFormTypeSegmented,
  draftCaptionsFromTranscript,
  applyOpenCaptionDraft,
  transcribeOpenTape,
  startOpenRecording,
  updateOpenRecordingStatus,
  stopOpenRecording,
  applyOpenCaptionState,
  submitOpenPacket,
  selectOpenPacket,
} = {}) {
  let judgeOpenHandlersBound = false;
  let tapePlaybackBound = false;

  return function bindJudgeOpenHandlers() {
    if (judgeOpenHandlersBound) return;
    judgeOpenHandlersBound = true;

    if (els.judgeOpenPacketSelect) {
      els.judgeOpenPacketSelect.addEventListener("change", async () => {
        const packetId = els.judgeOpenPacketSelect.value || "";
        await openJudgeOpenPacket(packetId);
      });
    }

    if (els.judgeOpenBackBtn) {
      els.judgeOpenBackBtn.addEventListener("click", () => {
        hideOpenDetailView();
      });
    }

    if (els.judgeOpenTapePlayback && !tapePlaybackBound) {
      tapePlaybackBound = true;
      els.judgeOpenTapePlayback.addEventListener("ended", () => {
        const playlist = state.judgeOpen.tapePlaylist || [];
        if (!playlist.length) return;
        const nextIndex = (state.judgeOpen.tapePlaylistIndex || 0) + 1;
        if (nextIndex >= playlist.length) {
          state.judgeOpen.tapePlaylistIndex = 0;
          return;
        }
        state.judgeOpen.tapePlaylistIndex = nextIndex;
        els.judgeOpenTapePlayback.src = playlist[nextIndex].url;
        els.judgeOpenTapePlayback.play();
      });
    }

    if (els.judgeOpenNewPacketBtn) {
      els.judgeOpenNewPacketBtn.addEventListener("click", async () => {
        if (!hasLinkedOpenEnsemble()) {
          setOpenPacketHint("Select an existing school and ensemble first.");
          return;
        }
        els.judgeOpenNewPacketBtn.dataset.loadingLabel = "Creating...";
        els.judgeOpenNewPacketBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenNewPacketBtn, async () => {
          setOpenPacketHint("Creating draft tape...");
          const payload = gatherOpenPacketMeta();
          const result = await createOpenPacket({ ...payload, onSessions: renderOpenSegments });
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Unable to create packet.");
            return;
          }
          state.judgeOpen.tapePlaylistIndex = 0;
          if (els.judgeOpenPacketSelect && result.packetId) {
            els.judgeOpenPacketSelect.value = result.packetId;
          }
          await saveOpenPrefsToServer({
            lastJudgeOpenPacketId: result.packetId,
            lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
          });
          if (state.auth.userProfile) {
            state.auth.userProfile.preferences = {
              ...(state.auth.userProfile.preferences || {}),
              lastJudgeOpenPacketId: result.packetId,
              lastJudgeOpenFormType: state.judgeOpen.formType || "stage",
            };
          }
          setOpenPacketHint("Draft packet created.");
          renderOpenCaptionForm();
          updateOpenHeader();
          showOpenDetailView();
          updateOpenEmptyState();
          updateOpenSubmitState();
        });
      });
    }

    if (els.judgeOpenClearRecentBtn) {
      els.judgeOpenClearRecentBtn.addEventListener("click", async () => {
        saveOpenPrefs({ lastPacketId: "", lastFormType: "" });
        await saveOpenPrefsToServer({
          lastJudgeOpenPacketId: "",
          lastJudgeOpenFormType: "",
        });
        if (state.auth.userProfile) {
          state.auth.userProfile.preferences = {
            ...(state.auth.userProfile.preferences || {}),
            lastJudgeOpenPacketId: "",
            lastJudgeOpenFormType: "",
          };
        }
        state.judgeOpen.currentPacketId = null;
        state.judgeOpen.currentPacket = null;
        state.judgeOpen.selectedExisting = null;
        setJudgeOpenDirectorReferenceState(
          "not-linked",
          "Link an existing ensemble to load Director repertoire/instrumentation.",
          null
        );
        renderJudgeOpenDirectorReference();
        if (els.judgeOpenPacketSelect) {
          els.judgeOpenPacketSelect.value = "";
        }
        if (els.judgeOpenTranscriptInput) {
          els.judgeOpenTranscriptInput.value = "";
        }
        state.judgeOpen.transcriptText = "";
        if (els.judgeOpenSchoolNameInput) {
          els.judgeOpenSchoolNameInput.value = "";
        }
        if (els.judgeOpenEnsembleNameInput) {
          els.judgeOpenEnsembleNameInput.value = "";
        }
        state.judgeOpen.captions = {};
        if (els.judgeOpenDraftStatus) {
          els.judgeOpenDraftStatus.textContent = "";
        }
        updateOpenHeader();
        hideOpenDetailView();
        setOpenPacketHint("Recent packet cleared.");
        renderOpenCaptionForm();
        updateOpenEmptyState();
        updateOpenSubmitState();
      });
    }

    if (els.judgeOpenDefaultFormBtn) {
      els.judgeOpenDefaultFormBtn.addEventListener("click", async () => {
        const formType = els.judgeOpenFormTypeSelect?.value || "stage";
        saveOpenPrefs({ defaultFormType: formType });
        await saveOpenPrefsToServer({ judgeOpenDefaultFormType: formType });
        if (state.auth.userProfile) {
          state.auth.userProfile.preferences = {
            ...(state.auth.userProfile.preferences || {}),
            judgeOpenDefaultFormType: formType,
          };
        }
        setOpenPacketHint("Default form saved.");
      });
    }

    if (els.judgeOpenUseEventDefaultsToggle) {
      els.judgeOpenUseEventDefaultsToggle.addEventListener("change", () => {
        state.judgeOpen.useActiveEventDefaults = Boolean(els.judgeOpenUseEventDefaultsToggle.checked);
        syncOpenEventDefaultsUI();
        refreshOpenEventDefaultsState();
        if (state.judgeOpen.useActiveEventDefaults) {
          setOpenPacketHint("Active event defaults enabled.");
        } else {
          setOpenPacketHint("Open mode enabled.");
        }
      });
    }

    if (els.judgeOpenSaveEventDefaultsBtn) {
      els.judgeOpenSaveEventDefaultsBtn.addEventListener("click", async () => {
        const enabled = getOpenEventDefaultsPreference();
        saveOpenPrefs({ useActiveEventDefaults: enabled });
        await saveOpenPrefsToServer({ judgeOpenUseActiveEventDefaults: enabled });
        if (state.auth.userProfile) {
          state.auth.userProfile.preferences = {
            ...(state.auth.userProfile.preferences || {}),
            judgeOpenUseActiveEventDefaults: enabled,
          };
        }
        setOpenPacketHint("Judge mode default saved.");
      });
    }

    if (els.judgeOpenExistingSelect) {
      els.judgeOpenExistingSelect.addEventListener("change", () => {
        const option = els.judgeOpenExistingSelect.selectedOptions?.[0];
        if (!option) return;
        const schoolId = option.dataset.schoolId || "";
        const ensembleId = option.dataset.ensembleId || "";
        const schoolName = option.dataset.schoolName || "";
        const ensembleName = option.dataset.ensembleName || "";
        if (els.judgeOpenSchoolNameInput) {
          els.judgeOpenSchoolNameInput.value = schoolName;
        }
        if (els.judgeOpenEnsembleNameInput) {
          els.judgeOpenEnsembleNameInput.value = ensembleName;
        }
        state.judgeOpen.selectedExisting = {
          schoolId,
          schoolName,
          ensembleId,
          ensembleName,
        };
        markJudgeOpenDirty();
        updateOpenHeader();
        if (state.judgeOpen.currentPacketId) {
          updateOpenPacketDraft({
            schoolId,
            ensembleId,
            schoolName,
            ensembleName,
            ensembleSnapshot: buildOpenEnsembleSnapshot(),
          });
        }
        refreshJudgeOpenDirectorReference({ persistToPacket: true });
        updateOpenSubmitState();
      });
    }

    if (els.judgeOpenFormTypeSelect) {
      els.judgeOpenFormTypeSelect.addEventListener("change", () => {
        state.judgeOpen.formType = els.judgeOpenFormTypeSelect.value || "stage";
        saveOpenPrefs({ lastFormType: state.judgeOpen.formType });
        renderOpenCaptionForm();
        syncOpenFormTypeSegmented();
        markJudgeOpenDirty();
        if (state.judgeOpen.currentPacketId) {
          updateOpenPacketDraft({ formType: state.judgeOpen.formType });
        }
      });
    }

    if (els.judgeOpenPrepTimePanel) {
      els.judgeOpenPrepTimePanel.querySelectorAll("[data-prep-mins]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const mins = Number(btn.dataset.prepMins || 5);
          if (state.judgeOpen.prepTimerId) {
            clearInterval(state.judgeOpen.prepTimerId);
            state.judgeOpen.prepTimerId = null;
          }
          state.judgeOpen.prepTimerEnd = Date.now() + mins * 60 * 1000;
          const tick = () => {
            const left = Math.max(0, state.judgeOpen.prepTimerEnd - Date.now());
            if (left <= 0) {
              if (state.judgeOpen.prepTimerId) {
                clearInterval(state.judgeOpen.prepTimerId);
                state.judgeOpen.prepTimerId = null;
              }
              if (els.judgeOpenPrepTimeDisplay) {
                els.judgeOpenPrepTimeDisplay.textContent = "Done";
                els.judgeOpenPrepTimeDisplay.className = "prep-time-display prep-time-done";
              }
              return;
            }
            const m = Math.floor(left / 60000);
            const s = Math.floor((left % 60000) / 1000);
            if (els.judgeOpenPrepTimeDisplay) {
              els.judgeOpenPrepTimeDisplay.textContent = `${m}:${String(s).padStart(2, "0")}`;
              els.judgeOpenPrepTimeDisplay.className = "prep-time-display";
            }
          };
          tick();
          state.judgeOpen.prepTimerId = setInterval(tick, 1000);
        });
      });
    }

    if (els.judgeOpenFormTypeSegmented) {
      els.judgeOpenFormTypeSegmented.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-form]");
        if (!button) return;
        const formType = button.dataset.form || "stage";
        state.judgeOpen.formType = formType;
        if (els.judgeOpenFormTypeSelect) {
          els.judgeOpenFormTypeSelect.value = formType;
        }
        saveOpenPrefs({ lastFormType: state.judgeOpen.formType });
        renderOpenCaptionForm();
        syncOpenFormTypeSegmented();
        if (els.judgeOpenPrepTimePanel) {
          els.judgeOpenPrepTimePanel.classList.toggle("is-hidden", formType !== "sight");
        }
        markJudgeOpenDirty();
        if (state.judgeOpen.currentPacketId) {
          updateOpenPacketDraft({ formType: state.judgeOpen.formType });
        }
      });
    }

    if (els.judgeOpenTranscriptInput) {
      els.judgeOpenTranscriptInput.addEventListener("input", () => {
        state.judgeOpen.transcriptText = els.judgeOpenTranscriptInput.value || "";
        markJudgeOpenDirty();
        updateOpenSubmitState();
      });
    }

    if (els.judgeOpenDraftBtn) {
      els.judgeOpenDraftBtn.addEventListener("click", async () => {
        const transcript = state.judgeOpen.transcriptText || "";
        if (!transcript.trim()) {
          if (els.judgeOpenDraftStatus) {
            els.judgeOpenDraftStatus.textContent = "Add a transcript before drafting captions.";
          }
          return;
        }
        if (!els.judgeOpenCaptionForm?.children?.length) {
          renderOpenCaptionForm();
        }
        const overwrite = Boolean(els.judgeOpenOverwriteCaptionsToggle?.checked);
        els.judgeOpenDraftBtn.dataset.loadingLabel = "Drafting...";
        els.judgeOpenDraftBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenDraftBtn, async () => {
          if (els.judgeOpenDraftStatus) {
            els.judgeOpenDraftStatus.textContent = "Drafting captions. Please wait...";
          }
          const result = await draftCaptionsFromTranscript({
            transcript,
            formType: state.judgeOpen.formType || "stage",
          });
          if (!result?.ok) {
            if (els.judgeOpenDraftStatus) {
              els.judgeOpenDraftStatus.textContent =
                result?.message || "Unable to draft captions.";
            }
            return;
          }
          applyOpenCaptionDraft({ captions: result.captions, overwrite });
          if (els.judgeOpenDraftStatus) {
            els.judgeOpenDraftStatus.textContent = "Drafted captions.";
          }
        });
      });
    }

    if (els.judgeOpenTranscribeBtn) {
      els.judgeOpenTranscribeBtn.addEventListener("click", async () => {
        if (els.judgeOpenTranscribeBtn.disabled) return;
        els.judgeOpenTranscribeBtn.dataset.loadingLabel = "Transcribing...";
        els.judgeOpenTranscribeBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenTranscribeBtn, async () => {
          const result = await transcribeOpenTape();
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Transcription failed.");
            return;
          }
          if (els.judgeOpenTranscriptInput) {
            els.judgeOpenTranscriptInput.value = result.transcript || "";
          }
          state.judgeOpen.transcriptText = result.transcript || "";
          updateOpenSubmitState();
          setOpenPacketHint("Transcription complete.");
        });
      });
    }

    if (els.judgeOpenRecordBtn) {
      els.judgeOpenRecordBtn.addEventListener("click", async () => {
        els.judgeOpenRecordBtn.dataset.loadingLabel = "Starting...";
        els.judgeOpenRecordBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenRecordBtn, async () => {
          const result = await startOpenRecording({
            getPacketMeta: gatherOpenPacketMeta,
            onSessions: renderOpenSegments,
            onStatus: updateOpenRecordingStatus,
          });
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Unable to start recording.");
            return;
          }
        });
        updateOpenRecordingStatus();
      });
    }

    if (els.judgeOpenStopBtn) {
      els.judgeOpenStopBtn.addEventListener("click", () => {
        els.judgeOpenStopBtn.dataset.loadingLabel = "Stopping...";
        els.judgeOpenStopBtn.dataset.spinner = "true";
        withLoading(els.judgeOpenStopBtn, async () => {
          stopOpenRecording();
        }).finally(() => {
          updateOpenRecordingStatus();
        });
      });
    }

    if (els.judgeOpenCaptionForm) {
      els.judgeOpenCaptionForm.addEventListener("click", (event) => {
        const gradeBtn = event.target?.closest?.("[data-grade]");
        const modifierBtn = event.target?.closest?.("[data-modifier]");
        const wrapper = event.target?.closest?.("[data-key]");
        if (!wrapper) return;
        const key = wrapper.dataset.key;
        const current = state.judgeOpen.captions[key] || {};
        if (gradeBtn) {
          const nextGrade = gradeBtn.dataset.grade || "";
          state.judgeOpen.captions[key] = {
            ...current,
            gradeLetter: nextGrade,
          };
          markJudgeOpenDirty();
          applyOpenCaptionState();
          updateOpenSubmitState();
        }
        if (modifierBtn) {
          const nextModifier = modifierBtn.dataset.modifier || "";
          state.judgeOpen.captions[key] = {
            ...current,
            gradeModifier: current.gradeModifier === nextModifier ? "" : nextModifier,
          };
          markJudgeOpenDirty();
          applyOpenCaptionState();
          updateOpenSubmitState();
        }
      });
      els.judgeOpenCaptionForm.addEventListener("input", (event) => {
        const wrapper = event.target?.closest?.("[data-key]");
        if (!wrapper) return;
        if (!event.target?.matches("[data-comment]")) return;
        const key = wrapper.dataset.key;
        const current = state.judgeOpen.captions[key] || {};
        state.judgeOpen.captions[key] = {
          ...current,
          comment: event.target.value || "",
        };
        markJudgeOpenDirty();
        applyOpenCaptionState();
        updateOpenSubmitState();
      });
    }

    if (els.judgeOpenSubmitBtn) {
      els.judgeOpenSubmitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        if (!hasLinkedOpenEnsemble()) {
          setOpenPacketHint("Select an existing school and ensemble before submitting.");
          return;
        }
        const result = await submitOpenPacket();
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Unable to submit packet.");
          return;
        }
        setOpenPacketHint("Submitted and locked. Admin must release to Director.");
        const refreshed = await selectOpenPacket(state.judgeOpen.currentPacketId, {
          onSessions: renderOpenSegments,
        });
        if (refreshed?.ok) {
          renderOpenCaptionForm();
          updateOpenHeader();
          showOpenDetailView();
          updateOpenSubmitState();
        }
      });
    }
  };
}
