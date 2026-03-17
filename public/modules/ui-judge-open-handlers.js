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
  renderOpenMicOptions,
  saveOpenPrefsToServer,
  renderOpenCaptionForm,
  updateOpenHeader,
  showOpenDetailView,
  updateOpenEmptyState,
  updateOpenSubmitState,
  saveOpenPrefs,
  refreshOpenMicrophones,
  markJudgeOpenDirty,
  buildOpenEnsembleSnapshot,
  updateOpenPacketDraft,
  refreshJudgeOpenDirectorReference,
  syncOpenFormTypeSegmented,
  draftCaptionsFromTranscript,
  applyOpenCaptionDraft,
  transcribeOpenTape,
  finalizeOpenTapeAutoTranscription,
  startOpenRecording,
  updateOpenRecordingStatus,
  stopOpenRecording,
  applyOpenCaptionState,
  submitOpenPacket,
  selectOpenPacket,
  chooseJudgeOpenMode,
  backToJudgeOpenLanding,
} = {}) {
  let judgeOpenHandlersBound = false;
  let tapePlaybackBound = false;
  let micDeviceListenerBound = false;
  const autoSizeCaptionTextarea = (textareaEl) => {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = `${Math.max(textareaEl.scrollHeight, 128)}px`;
  };

  async function waitForOpenRecordingSettle({
    timeoutMs = 30000,
    pollMs = 250,
  } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const recorder = state.judgeOpen.mediaRecorder;
      const pendingUploads = Number(state.judgeOpen.pendingUploads || 0);
      if (!recorder && pendingUploads === 0) {
        return true;
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, pollMs);
      });
    }
    return false;
  }

  async function refreshAndRenderOpenMicrophones() {
    try {
      const microphones = await refreshOpenMicrophones();
      renderOpenMicOptions(microphones);
    } catch (error) {
      console.error("Failed to refresh microphones", error);
      renderOpenMicOptions(state.judgeOpen.availableMicrophones || []);
      if (els.judgeOpenMicStatus) {
        els.judgeOpenMicStatus.textContent = "Unable to refresh microphones.";
      }
    }
  }

  async function persistOpenMicPreference(deviceId) {
    const normalizedDeviceId = String(deviceId || "");
    state.judgeOpen.selectedMicDeviceId = normalizedDeviceId;
    const selected = (state.judgeOpen.availableMicrophones || []).find(
      (item) => item.deviceId === normalizedDeviceId
    );
    state.judgeOpen.selectedMicLabel = selected?.label || "";
    saveOpenPrefs({ micDeviceId: normalizedDeviceId });
    renderOpenMicOptions(state.judgeOpen.availableMicrophones || []);
    try {
      await saveOpenPrefsToServer({ judgeOpenMicDeviceId: normalizedDeviceId });
      if (state.auth.userProfile) {
        state.auth.userProfile.preferences = {
          ...(state.auth.userProfile.preferences || {}),
          judgeOpenMicDeviceId: normalizedDeviceId,
        };
      }
    } catch (error) {
      console.error("Failed to save open microphone preference", error);
    }
  }

  return function bindJudgeOpenHandlers() {
    if (judgeOpenHandlersBound) return;
    judgeOpenHandlersBound = true;

    const handleOpenRecordStart = async (buttonEl = els.judgeOpenRecordBtn) => {
      if (!buttonEl) return;
      buttonEl.dataset.loadingLabel = "Starting...";
      buttonEl.dataset.spinner = "true";
      if (els.judgeOpenRecordingStatus) {
        els.judgeOpenRecordingStatus.textContent = "Starting microphone...";
      }
      await withLoading(buttonEl, async () => {
        const result = await startOpenRecording({
          getPacketMeta: gatherOpenPacketMeta,
          onSessions: renderOpenSegments,
          onStatus: updateOpenRecordingStatus,
        });
        if (!result?.ok) {
          setOpenPacketHint(result?.message || "Unable to start recording.");
          if (els.judgeOpenRecordingStatus) {
            els.judgeOpenRecordingStatus.textContent = "Unable to start recording.";
          }
          return;
        }
      });
      updateOpenRecordingStatus();
    };

    const handleJudgeOpenWorkflowAction = async (action, buttonEl) => {
      if (!action) return;
      if (action === "back-to-landing") {
        await backToJudgeOpenLanding();
        return;
      }
      if (action === "open-setup") {
        showOpenDetailView();
        if (els.judgeOpenExistingSelect) {
          try {
            els.judgeOpenExistingSelect.focus();
          } catch {
            // no-op
          }
        }
        setOpenPacketHint("Select an existing school and ensemble to continue.");
        return;
      }
      if (action === "start-recording") {
        showOpenDetailView();
        if (!hasLinkedOpenEnsemble()) {
          setOpenPacketHint("Select an existing school and ensemble first.");
          if (els.judgeOpenExistingSelect) {
            try {
              els.judgeOpenExistingSelect.focus();
            } catch {
              // no-op
            }
          }
          return;
        }
        await handleOpenRecordStart(buttonEl || els.judgeOpenRecordBtn);
      }
    };

    [
      els.judgeOpenEmptyPrimaryBtn,
      els.judgeOpenEmptySecondaryBtn,
      els.judgeOpenTapeEmptyPrimaryBtn,
      els.judgeOpenTapeEmptySecondaryBtn,
    ].forEach((buttonEl) => {
      if (!buttonEl) return;
      buttonEl.addEventListener("click", async () => {
        await handleJudgeOpenWorkflowAction(buttonEl.dataset.action || "", buttonEl);
      });
    });

    if (els.judgeOpenPacketSelect) {
      els.judgeOpenPacketSelect.addEventListener("change", async () => {
        if (state.judgeOpen.packetMutationInFlight) return;
        const packetId = els.judgeOpenPacketSelect.value || "";
        await openJudgeOpenPacket(packetId);
      });
    }

    if (els.judgeOpenChoosePracticeBtn) {
      els.judgeOpenChoosePracticeBtn.addEventListener("click", async () => {
        els.judgeOpenChoosePracticeBtn.dataset.loadingLabel = "Opening Practice...";
        await withLoading(els.judgeOpenChoosePracticeBtn, async () => {
          await chooseJudgeOpenMode("practice");
          await refreshAndRenderOpenMicrophones();
          setOpenPacketHint(
            "Practice workspace open. Resume a draft or choose New Assessment to create another one."
          );
        });
      });
    }
    if (els.judgeOpenChooseOfficialBtn) {
      els.judgeOpenChooseOfficialBtn.addEventListener("click", async () => {
        els.judgeOpenChooseOfficialBtn.dataset.loadingLabel = "Opening Official...";
        await withLoading(els.judgeOpenChooseOfficialBtn, async () => {
          await chooseJudgeOpenMode("official");
          await refreshAndRenderOpenMicrophones();
          setOpenPacketHint(
            "Official workspace open. Resume a draft or choose New Assessment to create another one."
          );
        });
      });
    }
    if (els.judgeOpenBackToLandingBtn) {
      els.judgeOpenBackToLandingBtn.addEventListener("click", async () => {
        await backToJudgeOpenLanding();
      });
    }

    if (els.judgeOpenMicSelect) {
      els.judgeOpenMicSelect.addEventListener("change", async () => {
        await persistOpenMicPreference(els.judgeOpenMicSelect.value || "");
      });
    }

    if (els.judgeOpenMicRefreshBtn) {
      els.judgeOpenMicRefreshBtn.addEventListener("click", async () => {
        els.judgeOpenMicRefreshBtn.dataset.loadingLabel = "Refreshing...";
        await withLoading(els.judgeOpenMicRefreshBtn, async () => {
          await refreshAndRenderOpenMicrophones();
        });
      });
    }

    if (!micDeviceListenerBound && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => {
        void refreshAndRenderOpenMicrophones();
      });
      micDeviceListenerBound = true;
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
          const firstUrl = playlist[0]?.url || "";
          if (firstUrl) {
            els.judgeOpenTapePlayback.src = firstUrl;
            try {
              els.judgeOpenTapePlayback.load();
            } catch {
              // no-op
            }
          }
          return;
        }
        state.judgeOpen.tapePlaylistIndex = nextIndex;
        els.judgeOpenTapePlayback.src = playlist[nextIndex].url;
        els.judgeOpenTapePlayback.play();
      });
    }

    if (els.judgeOpenNewPacketBtn) {
      els.judgeOpenNewPacketBtn.addEventListener("click", async () => {
        if (!state.judgeOpen.mode) {
          setOpenPacketHint("Choose Practice or Official before starting an assessment.");
          return;
        }
        if (state.judgeOpen.packetMutationInFlight) {
          setOpenPacketHint("Please wait for the current assessment action to complete.");
          return;
        }
        if (!hasLinkedOpenEnsemble()) {
          setOpenPacketHint("Select an existing school and ensemble first.");
          showOpenDetailView();
          if (els.judgeOpenExistingSelect) {
            try {
              els.judgeOpenExistingSelect.focus();
            } catch {
              // no-op
            }
          }
          return;
        }
        els.judgeOpenNewPacketBtn.dataset.loadingLabel = "Creating...";
        els.judgeOpenNewPacketBtn.dataset.spinner = "true";
        state.judgeOpen.detailViewIntent = "detail";
        const mutationToken = (state.judgeOpen.packetMutationToken || 0) + 1;
        state.judgeOpen.packetMutationToken = mutationToken;
        state.judgeOpen.packetMutationInFlight = true;
        try {
          await withLoading(els.judgeOpenNewPacketBtn, async () => {
            setOpenPacketHint("Creating draft assessment...");
            const payload = gatherOpenPacketMeta();
            const result = await createOpenPacket({
              ...payload,
              autoSelect: false,
            });
            if (state.judgeOpen.packetMutationToken !== mutationToken) return;
            if (!result?.ok) {
              setOpenPacketHint(result?.message || "Unable to create assessment.");
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
            setOpenPacketHint("Draft assessment created.");
            if (state.judgeOpen.detailViewIntent === "detail") {
              await openJudgeOpenPacket(result.packetId);
              if (state.judgeOpen.packetMutationToken !== mutationToken) return;
              renderOpenCaptionForm();
              updateOpenHeader();
              showOpenDetailView();
              updateOpenEmptyState();
              updateOpenSubmitState();
            }
          });
        } finally {
          if (state.judgeOpen.packetMutationToken === mutationToken) {
            state.judgeOpen.packetMutationInFlight = false;
          }
        }
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

    if (els.judgeOpenExistingSelect) {
      els.judgeOpenExistingSelect.addEventListener("change", () => {
        const option = els.judgeOpenExistingSelect.selectedOptions?.[0];
        if (!option) return;
        const schoolId = option.dataset.schoolId || "";
        const ensembleId = option.dataset.ensembleId || "";
        const schoolName = option.dataset.schoolName || "";
        const ensembleName = option.dataset.ensembleName || "";
        state.judgeOpen.selectedExisting = {
          schoolId,
          schoolName,
          ensembleId,
          ensembleName,
        };
        markJudgeOpenDirty();
        const startVersion = state.judgeOpen.draftVersion;
        updateOpenHeader();
        if (state.judgeOpen.currentPacketId) {
          updateOpenPacketDraft(
            {
              schoolId,
              ensembleId,
              schoolName,
              ensembleName,
              ensembleSnapshot: buildOpenEnsembleSnapshot(),
            },
            { clearDirtyIfUnchanged: true, startVersion }
          ).catch((error) => {
            console.error("Failed to persist selected open ensemble", error);
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
        const startVersion = state.judgeOpen.draftVersion;
        if (state.judgeOpen.currentPacketId) {
          updateOpenPacketDraft(
            { formType: state.judgeOpen.formType },
            { clearDirtyIfUnchanged: true, startVersion }
          ).catch((error) => {
            console.error("Failed to persist open form type", error);
          });
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
        const startVersion = state.judgeOpen.draftVersion;
        if (state.judgeOpen.currentPacketId) {
          updateOpenPacketDraft(
            { formType: state.judgeOpen.formType },
            { clearDirtyIfUnchanged: true, startVersion }
          ).catch((error) => {
            console.error("Failed to persist segmented open form type", error);
          });
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
            els.judgeOpenDraftStatus.textContent = "Add tape transcript text before drafting caption notes.";
          }
          return;
        }
        if (!els.judgeOpenCaptionForm?.children?.length) {
          renderOpenCaptionForm();
        }
        const overwrite = Boolean(els.judgeOpenOverwriteCaptionsToggle?.checked);
        const packet = state.judgeOpen.currentPacket || {};
        const selected = state.judgeOpen.selectedExisting || {};
        const directorRef = state.judgeOpen.directorEntryReference || {};
        const draftContext = {
          schoolName: selected.schoolName || packet.schoolName || "",
          ensembleName: selected.ensembleName || packet.ensembleName || "",
          judgePosition: packet.judgePosition || "",
          assignmentEventId: packet.assignmentEventId || "",
          performanceGrade:
            directorRef.performanceGrade ||
            packet.directorEntrySnapshot?.performanceGrade ||
            "",
          directorEntrySummary: {
            performanceGrade: directorRef.performanceGrade || "",
            performanceGradeFlex: Boolean(directorRef.performanceGradeFlex),
            repertoire:
              directorRef.repertoire && typeof directorRef.repertoire === "object" ?
                {
                  repertoireRuleMode: directorRef.repertoire.repertoireRuleMode || "",
                  march: directorRef.repertoire.march || {},
                  selection1: directorRef.repertoire.selection1 || {},
                  selection2: directorRef.repertoire.selection2 || {},
                } :
                {},
            instrumentation:
              directorRef.instrumentation && typeof directorRef.instrumentation === "object" ?
                {
                  totalPercussion: Number(directorRef.instrumentation.totalPercussion || 0),
                  otherInstrumentationNotes:
                    directorRef.instrumentation.otherInstrumentationNotes || "",
                } :
                {},
          },
        };
        els.judgeOpenDraftBtn.dataset.loadingLabel = "Drafting...";
        els.judgeOpenDraftBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenDraftBtn, async () => {
          if (els.judgeOpenDraftStatus) {
            els.judgeOpenDraftStatus.textContent = "Drafting optional caption notes. Please wait...";
          }
          const result = await draftCaptionsFromTranscript({
            transcript,
            formType: state.judgeOpen.formType || "stage",
            context: draftContext,
          });
          if (!result?.ok) {
            if (els.judgeOpenDraftStatus) {
              els.judgeOpenDraftStatus.textContent =
                result?.message || "Unable to draft optional caption notes.";
            }
            return;
          }
          const applyResult = applyOpenCaptionDraft({ captions: result.captions, overwrite });
          const meta = result.meta || {};
          if (els.judgeOpenDraftStatus) {
            if (meta.status === "model_failed") {
              els.judgeOpenDraftStatus.textContent =
                meta.message || "Drafting failed before captions were generated.";
            } else if (applyResult.appliedCount > 0 && applyResult.skippedExistingCount > 0 && !overwrite) {
              els.judgeOpenDraftStatus.textContent =
                `Drafted ${applyResult.appliedCount} caption note${applyResult.appliedCount === 1 ? "" : "s"}. Skipped ${applyResult.skippedExistingCount} existing caption note${applyResult.skippedExistingCount === 1 ? "" : "s"} because overwrite is off.`;
            } else if (applyResult.appliedCount > 0) {
              els.judgeOpenDraftStatus.textContent =
                `Drafted ${applyResult.appliedCount} caption note${applyResult.appliedCount === 1 ? "" : "s"}.`;
            } else if (!overwrite && applyResult.skippedExistingCount > 0) {
              els.judgeOpenDraftStatus.textContent =
                "No caption notes were inserted because overwrite is off.";
            } else if (meta.status === "no_supported_captions" || meta.generatedCount === 0) {
              els.judgeOpenDraftStatus.textContent =
                meta.message || "Drafting returned no usable caption notes.";
            } else {
              els.judgeOpenDraftStatus.textContent = "No caption notes were inserted.";
            }
          }
        });
      });
    }

    if (els.judgeOpenTranscribeBtn) {
      els.judgeOpenTranscribeBtn.textContent = "Refresh Auto Transcript";
      els.judgeOpenTranscribeBtn.addEventListener("click", async () => {
        if (els.judgeOpenTranscribeBtn.disabled) return;
        els.judgeOpenTranscribeBtn.dataset.loadingLabel = "Refreshing...";
        els.judgeOpenTranscribeBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenTranscribeBtn, async () => {
          if (els.judgeOpenRecordingStatus) {
            els.judgeOpenRecordingStatus.textContent = "Refreshing auto transcript reference...";
          }
          const result = await transcribeOpenTape();
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Auto transcript failed.");
            if (els.judgeOpenRecordingStatus) {
              els.judgeOpenRecordingStatus.textContent = "Auto transcript failed.";
            }
            return;
          }
          if (els.judgeOpenTranscriptInput) {
            els.judgeOpenTranscriptInput.value = result.transcript || "";
          }
          state.judgeOpen.transcriptText = result.transcript || "";
          updateOpenSubmitState();
          setOpenPacketHint("Auto transcript refreshed. Complete caption comments and scores before submitting.");
          if (els.judgeOpenRecordingStatus) {
            els.judgeOpenRecordingStatus.textContent = "Auto transcript reference ready.";
          }
        });
        updateOpenRecordingStatus();
      });
    }

    if (els.judgeOpenRecordBtn) {
      els.judgeOpenRecordBtn.addEventListener("click", async () => {
        await handleOpenRecordStart(els.judgeOpenRecordBtn);
      });
    }

    const handleOpenStop = async (buttonEl) => {
      if (buttonEl) {
        buttonEl.dataset.loadingLabel = "Stopping...";
        buttonEl.dataset.spinner = "true";
      }
      if (els.judgeOpenEmergencyStopBtn && buttonEl !== els.judgeOpenEmergencyStopBtn) {
        els.judgeOpenEmergencyStopBtn.disabled = true;
      }
      if (els.judgeOpenStopBtn && buttonEl !== els.judgeOpenStopBtn) {
        els.judgeOpenStopBtn.disabled = true;
      }
      if (els.judgeOpenRecordingStatus) {
        els.judgeOpenRecordingStatus.textContent = "Stopping and finalizing...";
      }
      await withLoading(buttonEl || els.judgeOpenStopBtn, async () => {
        const result = stopOpenRecording();
        if (!result?.ok) {
          if (els.judgeOpenRecordingStatus) {
            els.judgeOpenRecordingStatus.textContent = "No active recording.";
          }
          return;
        }
        const settled = await waitForOpenRecordingSettle();
        if (!settled) {
          setOpenPacketHint("Recording stopped. Auto transcript finalization is still catching up.");
          return;
        }
        if (els.judgeOpenRecordingStatus) {
          els.judgeOpenRecordingStatus.textContent = "Finalizing auto transcript reference...";
        }
        const finalResult = await finalizeOpenTapeAutoTranscription();
        if (!finalResult?.ok) {
          setOpenPacketHint(finalResult?.message || "Final auto transcript check failed.");
          return;
        }
        if (els.judgeOpenTranscriptInput) {
          els.judgeOpenTranscriptInput.value = finalResult.transcript || "";
        }
        state.judgeOpen.transcriptText = finalResult.transcript || "";
        updateOpenSubmitState();
        setOpenPacketHint("Auto transcript ready. Complete caption comments and scores before submitting.");
        if (els.judgeOpenRecordingStatus) {
          els.judgeOpenRecordingStatus.textContent = "Auto transcript reference ready.";
        }
      });
      updateOpenRecordingStatus();
    };

    if (els.judgeOpenStopBtn) {
      els.judgeOpenStopBtn.addEventListener("click", async () => {
        await handleOpenStop(els.judgeOpenStopBtn);
      });
    }

    if (els.judgeOpenEmergencyStopBtn) {
      els.judgeOpenEmergencyStopBtn.addEventListener("click", async () => {
        await handleOpenStop(els.judgeOpenEmergencyStopBtn);
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
        autoSizeCaptionTextarea(event.target);
        markJudgeOpenDirty();
        updateOpenSubmitState();
      });
    }

    if (els.judgeOpenSubmitBtn) {
      els.judgeOpenSubmitBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        if (els.judgeOpenSubmitBtn.disabled || els.judgeOpenSubmitBtn.dataset.loading === "true") {
          return;
        }
        if (!state.judgeOpen.mode) {
          setOpenPacketHint("Choose Practice or Official before submitting.");
          return;
        }
        if (!hasLinkedOpenEnsemble()) {
          setOpenPacketHint("Select an existing school and ensemble before submitting.");
          return;
        }
        if (state.judgeOpen.mode === "official") {
          const packet = state.judgeOpen.currentPacket || {};
          const eventId =
            packet.officialEventId ||
            packet.assignmentEventId ||
            state.judgeOpen.activeEventAssignment?.eventId ||
            "";
          const school = state.judgeOpen.selectedExisting?.schoolName || packet.schoolName || "School";
          const ensemble =
            state.judgeOpen.selectedExisting?.ensembleName || packet.ensembleName || "Ensemble";
          const ok = window.confirm(
            `Submit OFFICIAL assessment for ${school} - ${ensemble}${
              eventId ? ` in ${eventId}` : ""
            }?`
          );
          if (!ok) return;
        }
        els.judgeOpenSubmitBtn.dataset.loadingLabel = "Submitting...";
        els.judgeOpenSubmitBtn.dataset.spinner = "true";
        await withLoading(els.judgeOpenSubmitBtn, async () => {
          setOpenPacketHint("Submitting assessment...");
          const result = await submitOpenPacket();
          if (!result?.ok) {
            setOpenPacketHint(result?.message || "Unable to submit assessment.");
            return;
          }
          setOpenPacketHint("Assessment saved for admin review.");
          renderOpenCaptionForm();
          updateOpenHeader();
          showOpenDetailView();
          updateOpenSubmitState();
        });
      });
    }
  };
}
