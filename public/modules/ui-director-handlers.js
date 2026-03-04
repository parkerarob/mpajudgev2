export function createDirectorHandlerBinder({
  els,
  state,
  alertUser,
  setDirectorEvent,
  checkDirectorHasRegistrationForEvent,
  updateDirectorAttachUI,
  renderDirectorRegistrationPanel,
  openDirectorProfileModal,
  getDirectorSchoolId,
  upsertRegistrationForEnsemble,
  renderDayOfEnsembleSelector,
  loadDirectorEntry,
  applyDirectorEntryUpdate,
  applyDirectorEntryClear,
  generateSignatureFormPdf,
  uploadSignedSignatureForm,
  setDirectorEnsembleFormMode,
  closeDirectorEnsembleForm,
  attachDirectorSchool,
  setDirectorSchoolName,
  refreshDirectorWatchers,
  confirmUser,
  detachDirectorSchool,
  renderDirectorEnsembles,
  discardDirectorDraftChanges,
  setDirectorEntryStatusLabel,
  setDirectorReadyControls,
  renderDirectorChecklist,
  computeDirectorCompletionState,
  hasDirectorUnsavedChanges,
  updateDirectorEventMeta,
  renameDirectorEnsemble,
  createDirectorEnsemble,
  updateDirectorActiveEnsembleLabel,
  withLoading,
  renderInstrumentationNonStandard,
  applyDirectorDirty,
  markEntryDraft,
  markEntryReady,
  saveRepertoireSection,
  applyDirectorSaveResult,
  saveInstrumentationSection,
  saveRule3cSection,
  saveSeatingSection,
  savePercussionSection,
  saveLunchSection,
  uploadEventSchedulePdf,
  renderEventScheduleDetail,
  setDirectorProfileStatus,
  saveDirectorProfile,
  closeDirectorProfileModal,
  uploadDirectorProfileCard,
  renderDirectorProfile,
} = {}) {
  let directorHandlersBound = false;

  return function bindDirectorHandlers() {
    if (directorHandlersBound) return;
    directorHandlersBound = true;

    const goBtn = document.getElementById("directorEventGoBtn") || els.directorEventGoBtn;
    const eventSelect = document.getElementById("directorEventSelect") || els.directorEventSelect;
    if (goBtn && eventSelect) {
      goBtn.addEventListener("click", async () => {
        try {
          const eventId = eventSelect.value || null;
          if (!eventId) {
            alertUser("Select an event first.");
            return;
          }
          state.director.selectedEventId = eventId;
          setDirectorEvent(eventId);
          const hasReg = await checkDirectorHasRegistrationForEvent(eventId);
          if (hasReg) {
            state.director.view = "registered";
            updateDirectorAttachUI();
          } else {
            state.director.view = "registration";
            state.director.selectedEnsemblesForRegistration = [];
            updateDirectorAttachUI();
            await renderDirectorRegistrationPanel();
          }
        } catch (err) {
          console.error("Director Continue failed", err);
          alertUser(err?.message || "Something went wrong. Try again.");
        }
      });
    }
    if (els.directorRegistrationProfileBtn) {
      els.directorRegistrationProfileBtn.addEventListener("click", () => {
        openDirectorProfileModal();
      });
    }
    const saveRegBtn = document.getElementById("directorSaveRegistrationBtn") || els.directorSaveRegistrationBtn;
    if (saveRegBtn) {
      saveRegBtn.addEventListener("click", async () => {
        try {
          const schoolId = getDirectorSchoolId();
          const eventId = state.director.selectedEventId;
          const selectedIds = state.director.selectedEnsemblesForRegistration || [];
          const gfMap = state.director._registrationGradeFlexMap;
          if (!eventId || !schoolId || !selectedIds.length) {
            alertUser("Select at least one ensemble and complete the form.");
            return;
          }
          for (const ensembleId of selectedIds) {
            const gf = gfMap?.get(ensembleId);
            const commentsOnly = Boolean(gf?.commentsCheck?.checked) || Boolean(gf?.waiverCheck?.checked);
            await upsertRegistrationForEnsemble({
              eventId,
              schoolId,
              ensembleId,
              ensembleName: gf?.ensembleName || "",
              declaredGradeLevel: gf?.gradeSelect?.value?.trim() || "",
              declaredGradeFlex: Boolean(gf?.flexCheck?.checked),
              commentsOnly,
              feeWaiverRequested: Boolean(gf?.waiverCheck?.checked),
              datePreference: gf?.datePref?.value?.trim() || "",
              registrationNote: gf?.note?.value?.trim() || "",
            });
          }
          state.director.view = "registered";
          updateDirectorAttachUI();
        } catch (err) {
          console.error("Save registration failed", err);
          alertUser(err?.message || "Could not save registration.");
        }
      });
    }
    const editRegBtn = document.getElementById("directorEditRegistrationBtn");
    if (editRegBtn) {
      editRegBtn.addEventListener("click", async () => {
        state.director.view = "registration";
        updateDirectorAttachUI();
        await renderDirectorRegistrationPanel();
      });
    }
    const ensembleInfoBtn = document.getElementById("directorEnsembleInfoBtn");
    if (ensembleInfoBtn) {
      ensembleInfoBtn.addEventListener("click", () => {
        state.director.view = "dayOfForms";
        updateDirectorAttachUI();
        renderDayOfEnsembleSelector();
      });
    }
    const backToEventsBtn = document.getElementById("directorBackToEventsBtn");
    if (backToEventsBtn) {
      backToEventsBtn.addEventListener("click", () => {
        state.director.view = "landing";
        updateDirectorAttachUI();
      });
    }
    const dayOfBackBtn = document.getElementById("directorDayOfBackBtn");
    if (dayOfBackBtn) {
      dayOfBackBtn.addEventListener("click", () => {
        state.director.view = "registered";
        updateDirectorAttachUI();
      });
    }
    const dayOfEnsembleSelect = document.getElementById("directorDayOfEnsembleSelect");
    if (dayOfEnsembleSelect) {
      dayOfEnsembleSelect.addEventListener("change", () => {
        const ensembleId = dayOfEnsembleSelect.value;
        if (!ensembleId) return;
        state.director.selectedEnsembleId = ensembleId;
        loadDirectorEntry({
          onUpdate: applyDirectorEntryUpdate,
          onClear: applyDirectorEntryClear,
        });
      });
    }
    const printSigBtn = document.getElementById("directorPrintSignatureBtn");
    if (printSigBtn) {
      printSigBtn.addEventListener("click", () => {
        generateSignatureFormPdf();
      });
    }

    const uploadSignedFormBtn = document.getElementById("directorUploadSignedFormBtn");
    const signedFormInput = document.getElementById("directorSignedFormInput");
    const signedFormStatus = document.getElementById("directorSignedFormStatus");
    if (uploadSignedFormBtn && signedFormInput) {
      uploadSignedFormBtn.addEventListener("click", () => signedFormInput.click());
      signedFormInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const eventId = state.director.selectedEventId;
        const schoolId = getDirectorSchoolId();
        if (!eventId || !schoolId) {
          if (signedFormStatus) signedFormStatus.textContent = "Select an event and ensure you are attached to a school.";
          return;
        }
        if (signedFormStatus) signedFormStatus.textContent = "Uploading…";
        try {
          const result = await uploadSignedSignatureForm(eventId, schoolId, file);
          if (signedFormStatus) signedFormStatus.textContent = result.ok ? "Signed form uploaded." : (result.reason || "Upload failed.");
          if (result.ok) signedFormInput.value = "";
        } catch (err) {
          console.error("Upload signed form failed", err);
          if (signedFormStatus) signedFormStatus.textContent = "Upload failed. Check console.";
        }
      });
    }

    if (els.directorProfileToggleBtn) {
      els.directorProfileToggleBtn.addEventListener("click", () => {
        openDirectorProfileModal();
      });
    }

    if (els.directorShowEnsembleFormBtn) {
      els.directorShowEnsembleFormBtn.addEventListener("click", () => {
        setDirectorEnsembleFormMode({ mode: "create" });
        if (els.directorEnsembleNameInput) {
          els.directorEnsembleNameInput.focus();
        }
      });
    }

    if (els.directorEnsembleCancelBtn) {
      els.directorEnsembleCancelBtn.addEventListener("click", () => {
        closeDirectorEnsembleForm();
      });
    }

    if (els.directorEditActiveEnsembleBtn) {
      els.directorEditActiveEnsembleBtn.addEventListener("click", () => {
        const active = state.director.ensemblesCache.find(
          (ensemble) => ensemble.id === state.director.selectedEnsembleId
        );
        if (!active) return;
        setDirectorEnsembleFormMode({ mode: "edit", ensemble: active });
        els.directorEnsembleNameInput?.focus();
      });
    }

    if (els.directorAttachBtn) {
      els.directorAttachBtn.addEventListener("click", async () => {
        const schoolId = els.directorAttachSelect?.value || "";
        if (!schoolId) return;
        const result = await attachDirectorSchool(schoolId);
        if (result?.ok) {
          const selectedSchool = state.admin.schoolsList.find((school) => school.id === schoolId);
          if (state.auth.userProfile?.role === "admin") {
            setDirectorSchoolName(selectedSchool?.name || schoolId);
          }
          updateDirectorAttachUI();
          refreshDirectorWatchers();
        }
      });
    }

    if (els.directorDetachBtn) {
      els.directorDetachBtn.addEventListener("click", async () => {
        if (state.auth.userProfile?.role === "director") {
          alertUser("School selection is locked. Contact an admin to change it.");
          return;
        }
        const ok = confirmUser("Change school? This will clear your current selection.");
        if (!ok) return;
        const result = await detachDirectorSchool();
        if (result?.ok) {
          updateDirectorAttachUI();
          setDirectorSchoolName("No school attached");
          renderDirectorEnsembles([]);
          applyDirectorEntryClear({
            hint: "Select an ensemble and event to begin.",
            status: "Draft",
            readyStatus: "disabled",
          });
          refreshDirectorWatchers();
        }
      });
    }

    if (els.directorEnsembleForm) {
      els.directorEnsembleForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = els.directorEnsembleNameInput?.value.trim() || "";
        const editingEnsembleId = state.director.editingEnsembleId;
        if (!name) {
          if (els.directorEnsembleError) {
            els.directorEnsembleError.textContent = "Ensemble name is required.";
          }
          return;
        }
        if (
          !editingEnsembleId &&
          hasDirectorUnsavedChanges() &&
          !confirmUser("You have unsaved changes. Leave anyway?")
        ) {
          return;
        }
        if (els.directorEnsembleError) {
          els.directorEnsembleError.textContent = "";
        }
        const result = editingEnsembleId
          ? await renameDirectorEnsemble(editingEnsembleId, name)
          : await createDirectorEnsemble(name);
        if (result?.ok) {
          const resolvedName = String(result?.name || name || "").trim();
          if (editingEnsembleId) {
            discardDirectorDraftChanges();
            state.director.ensemblesCache = state.director.ensemblesCache.map((ensemble) =>
              ensemble.id === editingEnsembleId ? { ...ensemble, name: resolvedName } : ensemble
            );
            renderDirectorEnsembles(state.director.ensemblesCache);
            updateDirectorActiveEnsembleLabel();
          } else {
            discardDirectorDraftChanges();
          }
          closeDirectorEnsembleForm();
          await loadDirectorEntry({
            onUpdate: applyDirectorEntryUpdate,
            onClear: applyDirectorEntryClear,
          });
        }
      });
    }

    if (els.directorEventSelect) {
      els.directorEventSelect.addEventListener("change", () => {
        const nextId = els.directorEventSelect?.value || null;
        if (!nextId) return;
        if (hasDirectorUnsavedChanges() && !confirmUser("You have unsaved changes. Leave anyway?")) {
          els.directorEventSelect.value = state.director.selectedEventId || "";
          if (els.directorSetEventBtn) {
            els.directorSetEventBtn.disabled = !els.directorEventSelect.value;
          }
          return;
        }
        discardDirectorDraftChanges();
        setDirectorEvent(nextId);
        updateDirectorEventMeta();
        loadDirectorEntry({
          onUpdate: applyDirectorEntryUpdate,
          onClear: applyDirectorEntryClear,
        });
        if (els.directorEventPicker) {
          els.directorEventPicker.classList.add("is-hidden");
        }
      });
    }

    if (els.directorScheduleBtn) {
      els.directorScheduleBtn.addEventListener("click", () => {
        if (!state.director.selectedEventId) return;
        if (hasDirectorUnsavedChanges() && !confirmUser("You have unsaved changes. Leave anyway?")) {
          return;
        }
        discardDirectorDraftChanges();
        window.location.hash = `#event/${state.director.selectedEventId}`;
      });
    }

    if (els.directorChangeEventBtn) {
      els.directorChangeEventBtn.addEventListener("click", () => {
        if (els.directorEventPicker) {
          const isHidden = els.directorEventPicker.classList.contains("is-hidden");
          if (
            !isHidden &&
            hasDirectorUnsavedChanges() &&
            !confirmUser("You have unsaved changes. Leave anyway?")
          ) {
            return;
          }
          els.directorEventPicker.classList.toggle("is-hidden");
        }
      });
    }

    if (els.instrumentationNonStandardAddBtn) {
      els.instrumentationNonStandardAddBtn.addEventListener("click", () => {
        if (!state.director.entryDraft) return;
        state.director.entryDraft.instrumentation.nonStandard.push({
          instrumentName: "",
          count: 0,
        });
        renderInstrumentationNonStandard();
        applyDirectorDirty("instrumentation");
      });
    }

    if (els.directorEntryReadyBtn) {
      els.directorEntryReadyBtn.addEventListener("click", async () => {
        if (!state.director.entryDraft) return;
        const isReady = state.director.entryDraft.status === "ready";
        const result = isReady ? await markEntryDraft() : await markEntryReady();
        if (!result) return;
        if (!result.ok) {
          if (result.message) {
            alertUser(result.message);
          }
          return;
        }
        const nextStatus = isReady ? "Incomplete" : "Ready";
        setDirectorEntryStatusLabel(nextStatus);
        setDirectorReadyControls({ status: isReady ? "draft" : "ready" });
        renderDirectorChecklist(
          state.director.entryDraft,
          computeDirectorCompletionState(state.director.entryDraft)
        );
      });
    }

    if (els.saveRepertoireBtn) {
      els.saveRepertoireBtn.addEventListener("click", async () => {
        els.saveRepertoireBtn.dataset.loadingLabel = "Saving...";
        els.saveRepertoireBtn.dataset.spinner = "true";
        await withLoading(els.saveRepertoireBtn, async () => {
          const result = await saveRepertoireSection();
          applyDirectorSaveResult("repertoire", result);
        });
      });
    }
    if (els.saveInstrumentationBtn) {
      els.saveInstrumentationBtn.addEventListener("click", async () => {
        els.saveInstrumentationBtn.dataset.loadingLabel = "Saving...";
        els.saveInstrumentationBtn.dataset.spinner = "true";
        await withLoading(els.saveInstrumentationBtn, async () => {
          const result = await saveInstrumentationSection();
          applyDirectorSaveResult("instrumentation", result);
        });
      });
    }
    if (els.saveNonStandardBtn) {
      els.saveNonStandardBtn.addEventListener("click", async () => {
        els.saveNonStandardBtn.dataset.loadingLabel = "Saving...";
        els.saveNonStandardBtn.dataset.spinner = "true";
        await withLoading(els.saveNonStandardBtn, async () => {
          const result = await saveInstrumentationSection();
          applyDirectorSaveResult("nonStandard", result);
        });
      });
    }
    if (els.saveRule3cBtn) {
      els.saveRule3cBtn.addEventListener("click", async () => {
        els.saveRule3cBtn.dataset.loadingLabel = "Saving...";
        els.saveRule3cBtn.dataset.spinner = "true";
        await withLoading(els.saveRule3cBtn, async () => {
          const result = await saveRule3cSection();
          applyDirectorSaveResult("rule3c", result);
        });
      });
    }
    if (els.saveSeatingBtn) {
      els.saveSeatingBtn.addEventListener("click", async () => {
        els.saveSeatingBtn.dataset.loadingLabel = "Saving...";
        els.saveSeatingBtn.dataset.spinner = "true";
        await withLoading(els.saveSeatingBtn, async () => {
          const result = await saveSeatingSection();
          applyDirectorSaveResult("seating", result);
        });
      });
    }
    if (els.savePercussionBtn) {
      els.savePercussionBtn.addEventListener("click", async () => {
        els.savePercussionBtn.dataset.loadingLabel = "Saving...";
        els.savePercussionBtn.dataset.spinner = "true";
        await withLoading(els.savePercussionBtn, async () => {
          const result = await savePercussionSection();
          applyDirectorSaveResult("percussion", result);
        });
      });
    }
    if (els.saveLunchBtn) {
      els.saveLunchBtn.addEventListener("click", async () => {
        els.saveLunchBtn.dataset.loadingLabel = "Saving...";
        els.saveLunchBtn.dataset.spinner = "true";
        await withLoading(els.saveLunchBtn, async () => {
          const result = await saveLunchSection();
          applyDirectorSaveResult("lunch", result);
        });
      });
    }

    if (els.eventDetailBackBtn) {
      els.eventDetailBackBtn.addEventListener("click", () => {
        window.location.hash = `#${state.app.currentTab || "admin"}`;
      });
    }

    if (els.eventScheduleUploadBtn) {
      els.eventScheduleUploadBtn.addEventListener("click", async () => {
        const eventId = els.eventDetailPage?.dataset?.eventId || "";
        const file = els.eventScheduleFileInput?.files?.[0] || null;
        if (!eventId) {
          alertUser("Open an event detail page first.");
          return;
        }
        if (!file) {
          alertUser("Select a PDF to upload.");
          return;
        }
        els.eventScheduleUploadBtn.dataset.loadingLabel = "Uploading...";
        els.eventScheduleUploadBtn.dataset.spinner = "true";
        await withLoading(els.eventScheduleUploadBtn, async () => {
          try {
            if (els.eventScheduleStatus) {
              els.eventScheduleStatus.textContent = "Uploading schedule PDF...";
            }
            await uploadEventSchedulePdf(eventId, file);
            const event = state.event.list.find((item) => item.id === eventId) || null;
            renderEventScheduleDetail(event);
            if (els.eventScheduleStatus) {
              els.eventScheduleStatus.textContent = "Schedule PDF uploaded.";
            }
            if (els.eventScheduleFileInput) {
              els.eventScheduleFileInput.value = "";
            }
          } catch (error) {
            console.error("Event schedule upload failed", error);
            if (els.eventScheduleStatus) {
              els.eventScheduleStatus.textContent =
                error?.message || "Unable to upload schedule PDF.";
            }
          }
        });
      });
    }

    if (els.directorProfileNameInput) {
      els.directorProfileNameInput.addEventListener("input", () => {
        setDirectorProfileStatus("");
      });
    }

    if (els.directorProfileNafmeNumberInput) {
      els.directorProfileNafmeNumberInput.addEventListener("input", () => {
        setDirectorProfileStatus("");
      });
    }

    if (els.directorProfileNafmeExpInput) {
      els.directorProfileNafmeExpInput.addEventListener("change", () => {
        setDirectorProfileStatus("");
      });
    }

    if (els.directorProfileForm) {
      els.directorProfileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = els.directorProfileNameInput?.value.trim() || "";
        const nafmeNumber = els.directorProfileNafmeNumberInput?.value.trim() || "";
        const expValue = els.directorProfileNafmeExpInput?.value || "";
        const cellPhone = els.directorProfileCellPhoneInput?.value?.trim() || "";
        try {
          setDirectorProfileStatus("Saving...");
          await saveDirectorProfile({ name, nafmeNumber, expValue, cellPhone });
          setDirectorProfileStatus("Saved.");
          closeDirectorProfileModal();
        } catch (error) {
          console.error("Profile save failed", error);
          setDirectorProfileStatus(
            error?.code ? `Unable to save (${error.code}).` : "Unable to save."
          );
        }
      });
    }

    if (els.directorProfileCardInput) {
      els.directorProfileCardInput.addEventListener("change", async () => {
        const file = els.directorProfileCardInput.files?.[0];
        if (!file) return;
        try {
          setDirectorProfileStatus("Uploading...");
          await uploadDirectorProfileCard(file);
          renderDirectorProfile();
          setDirectorProfileStatus("Uploaded.");
        } catch (error) {
          console.error("Profile card upload failed", error);
          setDirectorProfileStatus(
            error?.code ? `Upload failed (${error.code}).` : "Upload failed."
          );
        }
      });
    }

    if (els.directorProfileClose) {
      els.directorProfileClose.addEventListener("click", closeDirectorProfileModal);
    }
    if (els.directorProfileCancelBtn) {
      els.directorProfileCancelBtn.addEventListener("click", closeDirectorProfileModal);
    }
    if (els.directorProfileBackdrop) {
      els.directorProfileBackdrop.addEventListener("click", closeDirectorProfileModal);
    }
  };
}
