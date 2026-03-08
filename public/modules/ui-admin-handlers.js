import {
  WALKTHROUGH_STEP_KEYS,
  computeReadinessControlState,
  isMissingWalkthroughCallableError,
  shouldRetryBulkResetCallable,
} from "./readiness-walkthrough.js";
import { getAdminHashForView } from "./admin-navigation.js";

export function createAdminHandlerBinder({
  els,
  state,
  windowObj,
  isAdminLiveEventEnabled,
  isAdminSettingsEnabled,
  applyAdminView,
  closeAdminSchoolDetail,
  renderAdminPacketsBySchedule,
  renderMockAdminPacketPreview,
  confirmUser,
  releaseMockPacketForAshleyTesting,
  alertUser,
  createEvent,
  saveAssignments,
  runEventPreflight,
  markReadinessStep,
  setReadinessWalkthrough,
  cleanupRehearsalArtifacts,
  renderAdminReadinessView,
  scheduleAdminPreflightRefresh,
  showStatusMessage,
  withLoading,
  saveSchool,
  resetAdminSchoolForm,
  getSelectedAdminSchool,
  startAdminSchoolEdit,
  deleteSchool,
  deleteEnsemble,
  bulkImportSchools,
  provisionUser,
  deleteUserAccount,
  renderAdminUsersDirectory,
  renderDirectorAssignmentsDirectory,
  getSelectedDirectorForAdmin,
  assignDirectorSchool,
  getSchoolNameById,
  unassignDirectorSchool,
  renderAdminSchoolEnsembleManage,
} = {}) {
  let adminHandlersBound = false;
  const extractDeleteUserErrorMessage = (error) => {
    const blockers = Array.isArray(error?.details?.blockers) ? error.details.blockers : [];
    if (!blockers.length) {
      return error?.message || "Unable to delete user.";
    }
    const details = blockers.map((blocker) => `- ${blocker.message || blocker.code || "Unknown blocker"}`);
    return `Unable to delete user:\n${details.join("\n")}`;
  };

  const syncProvisionSchoolField = () => {
    const role = els.provisionRoleSelect?.value || "judge";
    const isDirector = role === "director";
    if (els.provisionSchoolSelect) {
      els.provisionSchoolSelect.disabled = !isDirector;
      if (!isDirector) {
        els.provisionSchoolSelect.value = "";
      }
    }
  };

  const setReadinessControlsDisabled = (disabled) => {
    state.admin.readinessInFlight = Boolean(disabled);
    const hasActiveEvent = Boolean(state.event.active?.id);
    const isRehearsalEvent = String(state.event.active?.eventMode || "").trim().toLowerCase() === "rehearsal";
    const controlState = computeReadinessControlState({
      hasActiveEvent,
      readinessInFlight: state.admin.readinessInFlight,
      isRehearsalEvent,
    });
    if (els.adminWalkthroughStartBtn) {
      els.adminWalkthroughStartBtn.disabled = controlState.walkthroughStart.disabled;
      els.adminWalkthroughStartBtn.title = controlState.walkthroughStart.title;
    }
    if (els.adminWalkthroughResetBtn) {
      els.adminWalkthroughResetBtn.disabled = controlState.walkthroughReset.disabled;
      els.adminWalkthroughResetBtn.title = controlState.walkthroughReset.title;
    }
    if (els.adminRunPreflightBtn) {
      els.adminRunPreflightBtn.disabled = controlState.runPreflight.disabled;
      els.adminRunPreflightBtn.title = controlState.runPreflight.title;
    }
    if (els.adminCleanupRehearsalBtn) {
      els.adminCleanupRehearsalBtn.disabled = controlState.cleanupRehearsal.disabled;
      els.adminCleanupRehearsalBtn.title = controlState.cleanupRehearsal.title;
    }
    Array.from(document.querySelectorAll("[data-readiness-step]")).forEach((btn) => {
      btn.disabled = controlState.readinessStepsDisabled;
    });
    Array.from(document.querySelectorAll("[data-readiness-open-view]")).forEach((btn) => {
      btn.disabled = controlState.readinessOpenViewDisabled;
    });
  };
  const isReadinessBusy = () => Boolean(state.admin.readinessInFlight);

  const resetWalkthroughSteps = async ({ eventId, note }) => {
    const nowMs = Date.now();
    const retryCooldownMs = 5 * 60 * 1000;
    const canRetryBulkCallable = shouldRetryBulkResetCallable({
      supportState: state.admin.readinessBulkResetSupport,
      checkedAt: state.admin.readinessBulkResetCheckedAt,
      nowMs,
      retryCooldownMs,
    });
    if (canRetryBulkCallable) {
      try {
        await setReadinessWalkthrough({
          eventId,
          status: "incomplete",
          note,
        });
        state.admin.readinessBulkResetSupport = "available";
        state.admin.readinessBulkResetCheckedAt = nowMs;
        return;
      } catch (error) {
        const missingCallable = isMissingWalkthroughCallableError(error);
        if (!missingCallable) throw error;
        state.admin.readinessBulkResetSupport = "unavailable";
        state.admin.readinessBulkResetCheckedAt = nowMs;
      }
    }
    for (const stepKey of WALKTHROUGH_STEP_KEYS) {
      await markReadinessStep({
        eventId,
        stepKey,
        status: "incomplete",
        note,
      });
    }
  };

  return function bindAdminHandlers() {
    if (adminHandlersBound) return;
    adminHandlersBound = true;
    Array.from(els.adminSubnav?.querySelectorAll("[data-admin-view]") || []).forEach((btn) => {
      const view = btn.getAttribute("data-admin-view");
      if (!view) return;
      btn.addEventListener("click", () => {
        if (isReadinessBusy()) return;
        if (view === "liveEvent" && !isAdminLiveEventEnabled()) return;
        if (view === "settings" && !isAdminSettingsEnabled()) return;
        if (view === "preEvent") {
          state.admin.selectedSchoolId = null;
          state.admin.selectedSchoolName = "";
        }
        state.admin.currentView = view;
        applyAdminView(view);
        const hash = getAdminHashForView(view);
        if (windowObj.location.hash !== hash) {
          windowObj.location.hash = hash;
        }
      });
    });

    if (els.adminSchoolDetailBackBtn) {
      els.adminSchoolDetailBackBtn.addEventListener("click", () => {
        closeAdminSchoolDetail();
      });
    }

    if (els.adminSafeModeLoadBtn) {
      els.adminSafeModeLoadBtn.addEventListener("click", () => {
        const view = state.admin.currentView;
        if (view === "preEvent") state.admin.preEventHeavyLoaded = true;
        if (view === "liveEvent") state.admin.liveEventHeavyLoaded = true;
        applyAdminView(view);
      });
    }

    if (els.adminPacketsSchoolSelect) {
      els.adminPacketsSchoolSelect.addEventListener("change", () => {
        state.admin.packetsSchoolId = els.adminPacketsSchoolSelect?.value || "";
        if (state.admin.currentView === "packets") {
          renderAdminPacketsBySchedule();
        }
      });
    }

    if (els.adminPacketsMockPreviewBtn) {
      els.adminPacketsMockPreviewBtn.addEventListener("click", () => {
        if (!els.adminPacketsMockPanel) return;
        const isHidden = els.adminPacketsMockPanel.classList.contains("is-hidden");
        if (isHidden) {
          renderMockAdminPacketPreview();
          els.adminPacketsMockPanel.classList.remove("is-hidden");
          els.adminPacketsMockPreviewBtn.textContent = "Hide Mock Preview";
        } else {
          els.adminPacketsMockPanel.classList.add("is-hidden");
          els.adminPacketsMockPanel.innerHTML = "";
          els.adminPacketsMockPreviewBtn.textContent = "Preview Full Packet (Mock)";
        }
      });
    }
    if (els.adminPacketsReleaseAshleyMockBtn) {
      els.adminPacketsReleaseAshleyMockBtn.addEventListener("click", async () => {
        const ok = confirmUser("Release a mock 4-judge packet to Ashley High School for testing?");
        if (!ok) return;
        els.adminPacketsReleaseAshleyMockBtn.dataset.loadingLabel = "Releasing...";
        await withLoading(els.adminPacketsReleaseAshleyMockBtn, async () => {
          try {
            const result = await releaseMockPacketForAshleyTesting();
            alertUser(
              `Mock packet released for ${result.schoolName || "Ashley High School"} - ${result.ensembleName || result.ensembleId}.`
            );
            if (state.admin.currentView === "packets") {
              renderAdminPacketsBySchedule();
            }
          } catch (error) {
            console.error("releaseMockPacketForAshleyTesting failed", error);
            alertUser(error?.message || "Unable to release mock packet.");
          }
        });
      });
    }

    if (els.createEventBtn) {
      els.createEventBtn.addEventListener("click", async () => {
        const name = els.eventNameInput?.value.trim() || "";
        const eventMode = els.eventModeInput?.value || "live";
        if (!name) {
          alertUser("Enter an event name.");
          return;
        }
        const now = new Date();
        const startAtDate = new Date(now);
        const endAtDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        els.createEventBtn.dataset.loadingLabel = "Creating...";
        await withLoading(els.createEventBtn, async () => {
          await createEvent({ name, eventMode, startAtDate, endAtDate });
          if (els.eventNameInput) els.eventNameInput.value = "";
          scheduleAdminPreflightRefresh?.();
        });
      });
    }

    if (els.assignmentsForm) {
      const assignmentSelects = [
        { select: els.stage1JudgeSelect, key: "stage1Uid" },
        { select: els.stage2JudgeSelect, key: "stage2Uid" },
        { select: els.stage3JudgeSelect, key: "stage3Uid" },
        { select: els.sightJudgeSelect, key: "sightUid" },
      ].filter((entry) => Boolean(entry.select));
      assignmentSelects.forEach(({ select, key }) => {
        select.addEventListener("change", () => {
          state.admin.assignmentsDirty = true;
          state.admin.assignmentsDraft = {
            ...(state.admin.assignmentsDraft || {}),
            [key]: select.value || "",
          };
        });
      });
      els.assignmentsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.event.active) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Create and activate an event first.";
          }
          return;
        }
        const stage1Uid = els.stage1JudgeSelect?.value || state.admin.assignmentsDraft?.stage1Uid || "";
        const stage2Uid = els.stage2JudgeSelect?.value || state.admin.assignmentsDraft?.stage2Uid || "";
        const stage3Uid = els.stage3JudgeSelect?.value || state.admin.assignmentsDraft?.stage3Uid || "";
        const sightUid = els.sightJudgeSelect?.value || state.admin.assignmentsDraft?.sightUid || "";
        if (!stage1Uid || !stage2Uid || !stage3Uid || !sightUid) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Select all judge assignments.";
          }
          return;
        }
        const unique = new Set([stage1Uid, stage2Uid, stage3Uid, sightUid]);
        if (unique.size !== 4) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Each judge position must be assigned to a unique user.";
          }
          return;
        }
        if (els.assignmentsError) els.assignmentsError.textContent = "";
        try {
          await saveAssignments({
            eventId: state.event.active.id,
            stage1Uid,
            stage2Uid,
            stage3Uid,
            sightUid,
          });
          state.admin.assignmentsDirty = false;
          state.admin.assignmentsDraft = {
            stage1Uid,
            stage2Uid,
            stage3Uid,
            sightUid,
          };
          scheduleAdminPreflightRefresh?.({ immediate: true });
          showStatusMessage(els.assignmentsError, "Assignments saved.");
        } catch (error) {
          console.error("Assignments save failed", error);
          showStatusMessage(
            els.assignmentsError,
            "Unable to save assignments. Check console for details.",
            "error"
          );
        }
      });
    }

    const openAdminView = (view) => {
      if (!view) return;
      if (isReadinessBusy()) return;
      if (view === "liveEvent" && !isAdminLiveEventEnabled()) return;
      if (view === "settings" && !isAdminSettingsEnabled()) return;
      state.admin.currentView = view;
      applyAdminView(view);
      const hash = getAdminHashForView(view);
      if (windowObj.location.hash !== hash) {
        windowObj.location.hash = hash;
      }
    };

    if (els.adminRunPreflightBtn) {
      els.adminRunPreflightBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        setReadinessControlsDisabled(true);
        try {
          await runEventPreflight({ eventId });
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("runEventPreflight failed", error);
          alertUser(error?.message || "Unable to run preflight.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    if (els.adminWalkthroughStartBtn) {
      els.adminWalkthroughStartBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        const confirmed = confirmUser(
          "Start walkthrough? This resets walkthrough checkpoints to incomplete."
        );
        if (!confirmed) return;
        setReadinessControlsDisabled(true);
        try {
          await resetWalkthroughSteps({
            eventId,
            note: "Walkthrough started",
          });
          await runEventPreflight({ eventId });
          scheduleAdminPreflightRefresh?.({ immediate: true });
          await renderAdminReadinessView?.();
          openAdminView("settings");
        } catch (error) {
          console.error("walkthrough start failed", error);
          alertUser(error?.message || "Unable to start walkthrough.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    if (els.adminWalkthroughResetBtn) {
      els.adminWalkthroughResetBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        const confirmed = confirmUser("Reset walkthrough checkpoints to incomplete?");
        if (!confirmed) return;
        setReadinessControlsDisabled(true);
        try {
          await resetWalkthroughSteps({
            eventId,
            note: "Walkthrough reset",
          });
          scheduleAdminPreflightRefresh?.({ immediate: true });
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("walkthrough reset failed", error);
          alertUser(error?.message || "Unable to reset walkthrough.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    Array.from(document.querySelectorAll("[data-readiness-open-view]")).forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isReadinessBusy()) return;
        const view = btn.getAttribute("data-readiness-open-view") || "";
        if (!view) return;
        openAdminView(view);
      });
    });

    if (els.adminCleanupRehearsalBtn) {
      els.adminCleanupRehearsalBtn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        if (!eventId) {
          alertUser("Set an active event first.");
          return;
        }
        const ok = confirmUser("Delete unreleased rehearsal packets/open sheets for the active event?");
        if (!ok) return;
        setReadinessControlsDisabled(true);
        try {
          const result = await cleanupRehearsalArtifacts({ eventId });
          alertUser(
            `Cleanup complete. Open deleted: ${result.deletedOpenPackets || 0}; scheduled deleted: ${result.deletedScheduledPackets || 0}; released skipped: ${(result.skippedReleasedOpenPackets || 0) + (result.skippedReleasedScheduledPackets || 0)}.`
          );
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("cleanupRehearsalArtifacts failed", error);
          alertUser(error?.message || "Unable to cleanup rehearsal artifacts.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    }

    Array.from(document.querySelectorAll("[data-readiness-step]")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (isReadinessBusy()) return;
        const eventId = state.event.active?.id || "";
        const stepKey = btn.getAttribute("data-readiness-step") || "";
        const status = String(btn.dataset.targetStatus || "complete").trim().toLowerCase() === "incomplete" ?
          "incomplete" :
          "complete";
        if (!eventId || !stepKey) {
          alertUser("Set an active event first.");
          return;
        }
        setReadinessControlsDisabled(true);
        try {
          const note = status === "complete" ?
            "Marked complete in Readiness UI" :
            "Marked incomplete in Readiness UI";
          await markReadinessStep({
            eventId,
            stepKey,
            status,
            note,
          });
          scheduleAdminPreflightRefresh?.({ immediate: true });
          await renderAdminReadinessView?.();
        } catch (error) {
          console.error("markReadinessStep failed", error);
          alertUser(error?.message || "Unable to update readiness step.");
        } finally {
          setReadinessControlsDisabled(false);
        }
      });
    });

    if (els.schoolForm) {
      els.schoolForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const schoolId = state.admin.schoolEditId || (els.schoolIdCreateInput?.value.trim() || "");
        const name = els.schoolNameCreateInput?.value.trim() || "";
        if (!schoolId || !name) {
          alertUser("Enter a school ID and name.");
          return;
        }
        await saveSchool({ schoolId, name });
        scheduleAdminPreflightRefresh?.();
        if (els.schoolResult) {
          els.schoolResult.textContent = state.admin.schoolEditId
            ? `Updated ${schoolId}.`
            : `Added ${schoolId}.`;
        }
        resetAdminSchoolForm();
      });
    }

    if (els.schoolEditCancelBtn) {
      els.schoolEditCancelBtn.addEventListener("click", () => {
        resetAdminSchoolForm();
        if (els.schoolResult) els.schoolResult.textContent = "";
      });
    }

    if (els.adminSchoolManageSelect) {
      els.adminSchoolManageSelect.addEventListener("change", async () => {
        const hasSelection = Boolean(els.adminSchoolManageSelect?.value);
        if (els.adminSchoolManageEditBtn) {
          els.adminSchoolManageEditBtn.disabled = !hasSelection;
        }
        if (els.adminSchoolManageDeleteBtn) {
          els.adminSchoolManageDeleteBtn.disabled = !hasSelection;
        }
        await renderAdminSchoolEnsembleManage?.();
      });
    }

    if (els.adminSchoolEnsembleManageSelect) {
      els.adminSchoolEnsembleManageSelect.addEventListener("change", () => {
        if (els.adminSchoolEnsembleDeleteBtn) {
          els.adminSchoolEnsembleDeleteBtn.disabled = !els.adminSchoolEnsembleManageSelect?.value;
        }
      });
    }

    if (els.adminSchoolManageEditBtn) {
      els.adminSchoolManageEditBtn.addEventListener("click", () => {
        const school = getSelectedAdminSchool();
        if (!school) return;
        startAdminSchoolEdit(school);
      });
    }

    if (els.adminSchoolManageDeleteBtn) {
      els.adminSchoolManageDeleteBtn.addEventListener("click", async () => {
        const school = getSelectedAdminSchool();
        if (!school) return;
        const label = school.name || school.id;
        const ok = confirmUser(
          `Delete school ${label}? This only works if no ensembles, users, entries, schedule items, or open packets reference it.`
        );
        if (!ok) return;
        try {
          await deleteSchool({ schoolId: school.id });
          scheduleAdminPreflightRefresh?.();
          if (state.admin.schoolEditId === school.id) {
            resetAdminSchoolForm();
          }
          if (els.schoolResult) {
            els.schoolResult.textContent = `Deleted ${school.id}.`;
          }
        } catch (error) {
          console.error("Delete school failed", error);
          const message = error?.message || "Unable to delete school.";
          alertUser(message);
        }
      });
    }

    if (els.adminSchoolEnsembleDeleteBtn) {
      els.adminSchoolEnsembleDeleteBtn.addEventListener("click", async () => {
        const school = getSelectedAdminSchool();
        const ensembleId = els.adminSchoolEnsembleManageSelect?.value || "";
        if (!school || !ensembleId) return;
        const ensembleName =
          state.admin.schoolManageEnsembles?.find((item) => item.id === ensembleId)?.name || ensembleId;
        const schoolLabel = school.name || school.id;
        const ok = confirmUser(
          `Delete ensemble ${ensembleName} from ${schoolLabel}? This will fully remove linked schedule, entries, submissions, and packets.`
        );
        if (!ok) return;
        els.adminSchoolEnsembleDeleteBtn.dataset.loadingLabel = "Deleting...";
        await withLoading(els.adminSchoolEnsembleDeleteBtn, async () => {
          try {
            await deleteEnsemble({ schoolId: school.id, ensembleId, force: true });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            if (els.schoolResult) {
              els.schoolResult.textContent = `Deleted ensemble ${ensembleName} from ${schoolLabel}.`;
            }
            await renderAdminSchoolEnsembleManage?.();
            if (state.admin.currentView === "preEvent") {
              applyAdminView("preEvent");
            }
          } catch (error) {
            console.error("Delete ensemble failed", error);
            const message = error?.message || "Unable to delete ensemble.";
            alertUser(message);
          }
        });
      });
    }

    if (els.schoolBulkBtn) {
      els.schoolBulkBtn.addEventListener("click", async () => {
        const raw = els.schoolBulkInput?.value || "";
        const lines = raw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [schoolId, ...nameParts] = line.split(",");
            return { schoolId: (schoolId || "").trim(), name: nameParts.join(",").trim() };
          });
        const result = await bulkImportSchools(lines);
        scheduleAdminPreflightRefresh?.();
        if (els.schoolResult) {
          els.schoolResult.textContent = `Imported ${result.count} schools.`;
        }
      });
    }

    if (els.provisionForm) {
      syncProvisionSchoolField();
      if (els.provisionRoleSelect) {
        els.provisionRoleSelect.addEventListener("change", syncProvisionSchoolField);
      }
      els.provisionForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = els.provisionEmailInput?.value.trim() || "";
        const name = els.provisionNameInput?.value.trim() || "";
        const role = els.provisionRoleSelect?.value || "judge";
        const schoolId = role === "director" ? (els.provisionSchoolSelect?.value || null) : null;
        const tempPassword = els.provisionTempPasswordInput?.value.trim() || "";
        if (!email || !name) {
          alertUser("Email and name are required.");
          return;
        }
        const result = await provisionUser({
          email,
          displayName: name,
          role,
          schoolId,
          tempPassword: tempPassword || null,
        });
        if (els.provisionResult) {
          const password = result?.generatedPassword || tempPassword || "";
          els.provisionResult.textContent = password
            ? `Provisioned. Temp password: ${password}`
            : "Provisioned.";
        }
        renderAdminUsersDirectory?.();
        renderDirectorAssignmentsDirectory();
        scheduleAdminPreflightRefresh?.();
      });
    }

    if (els.adminUsersList) {
      els.adminUsersList.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-delete-user-uid]");
        if (!button) return;
        const targetUid = button.getAttribute("data-delete-user-uid") || "";
        if (!targetUid) return;
        const user = (state.admin.usersList || []).find((item) => item.uid === targetUid);
        if (!user) return;
        const label = user.displayName || user.email || user.uid;
        const role = user.role || "unknown";
        const confirmed = confirmUser(
          `Full delete ${label} (${role})?\n\nThis removes Auth and the user profile, and will fail if linked records still exist.`
        );
        if (!confirmed) return;
        button.dataset.loadingLabel = "Deleting...";
        await withLoading(button, async () => {
          try {
            await deleteUserAccount({ targetUid });
            scheduleAdminPreflightRefresh?.({ immediate: true });
            if (els.adminUsersResult) {
              els.adminUsersResult.textContent = `Deleted ${label}.`;
            }
            renderAdminUsersDirectory?.();
            renderDirectorAssignmentsDirectory?.();
          } catch (error) {
            console.error("deleteUserAccount failed", error);
            if (els.adminUsersResult) {
              els.adminUsersResult.textContent = extractDeleteUserErrorMessage(error);
            }
            alertUser(extractDeleteUserErrorMessage(error));
          }
        });
      });
    }

    if (els.directorAssignDirectorSelect) {
      els.directorAssignDirectorSelect.addEventListener("change", () => {
        renderDirectorAssignmentsDirectory();
      });
    }
    if (els.directorAssignSchoolSelect) {
      els.directorAssignSchoolSelect.addEventListener("change", () => {
        renderDirectorAssignmentsDirectory();
      });
    }
    if (els.directorAssignBtn) {
      els.directorAssignBtn.addEventListener("click", async () => {
        const director = getSelectedDirectorForAdmin();
        const schoolId = els.directorAssignSchoolSelect?.value || "";
        if (!director || !schoolId) return;
        els.directorAssignBtn.dataset.loadingLabel = "Assigning...";
        await withLoading(els.directorAssignBtn, async () => {
          try {
            await assignDirectorSchool({ directorUid: director.uid, schoolId });
            scheduleAdminPreflightRefresh?.();
            if (els.directorManageResult) {
              const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
              els.directorManageResult.textContent = `Assigned ${director.displayName || director.email || director.uid} to ${schoolName}.`;
            }
          } catch (error) {
            console.error("assignDirectorSchool failed", error);
            if (els.directorManageResult) {
              els.directorManageResult.textContent = error?.message || "Unable to assign director.";
            }
          }
        });
      });
    }
    if (els.directorUnassignBtn) {
      els.directorUnassignBtn.addEventListener("click", async () => {
        const director = getSelectedDirectorForAdmin();
        if (!director || !director.schoolId) return;
        const label = director.displayName || director.email || director.uid;
        if (!confirmUser(`Remove ${label} from their school assignment?`)) return;
        els.directorUnassignBtn.dataset.loadingLabel = "Removing...";
        await withLoading(els.directorUnassignBtn, async () => {
          try {
            await unassignDirectorSchool({ directorUid: director.uid });
            scheduleAdminPreflightRefresh?.();
            if (els.directorManageResult) {
              els.directorManageResult.textContent = `Removed ${label} from school assignment.`;
            }
          } catch (error) {
            console.error("unassignDirectorSchool failed", error);
            if (els.directorManageResult) {
              els.directorManageResult.textContent = error?.message || "Unable to remove director.";
            }
          }
        });
      });
    }
  };
}
