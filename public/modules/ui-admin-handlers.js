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
  showStatusMessage,
  saveSchool,
  resetAdminSchoolForm,
  getSelectedAdminSchool,
  startAdminSchoolEdit,
  deleteSchool,
  bulkImportSchools,
  provisionUser,
  renderDirectorAssignmentsDirectory,
  getSelectedDirectorForAdmin,
  assignDirectorSchool,
  getSchoolNameById,
  unassignDirectorSchool,
} = {}) {
  let adminHandlersBound = false;

  return function bindAdminHandlers() {
    if (adminHandlersBound) return;
    adminHandlersBound = true;
    Array.from(els.adminSubnav?.querySelectorAll("[data-admin-view]") || []).forEach((btn) => {
      const view = btn.getAttribute("data-admin-view");
      if (!view) return;
      btn.addEventListener("click", () => {
        if (view === "liveEvent" && !isAdminLiveEventEnabled()) return;
        if (view === "settings" && !isAdminSettingsEnabled()) return;
        if (view === "preEvent") {
          state.admin.selectedSchoolId = null;
          state.admin.selectedSchoolName = "";
        }
        state.admin.currentView = view;
        applyAdminView(view);
        const hash =
          view === "preEvent"
            ? "#admin"
            : view === "liveEvent"
              ? "#admin/live"
              : `#admin/${view}`;
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
        els.adminPacketsReleaseAshleyMockBtn.disabled = true;
        const originalLabel = els.adminPacketsReleaseAshleyMockBtn.textContent;
        els.adminPacketsReleaseAshleyMockBtn.textContent = "Releasing...";
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
        } finally {
          els.adminPacketsReleaseAshleyMockBtn.disabled = false;
          els.adminPacketsReleaseAshleyMockBtn.textContent = originalLabel || "Release Mock to Ashley HS";
        }
      });
    }

    if (els.createEventBtn) {
      els.createEventBtn.addEventListener("click", async () => {
        const name = els.eventNameInput?.value.trim() || "";
        if (!name) {
          alertUser("Enter an event name.");
          return;
        }
        const now = new Date();
        const startAtDate = new Date(now);
        const endAtDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await createEvent({ name, startAtDate, endAtDate });
        if (els.eventNameInput) els.eventNameInput.value = "";
      });
    }

    if (els.assignmentsForm) {
      els.assignmentsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.event.active) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Create and activate an event first.";
          }
          return;
        }
        const stage1Uid = els.stage1JudgeSelect?.value || "";
        const stage2Uid = els.stage2JudgeSelect?.value || "";
        const stage3Uid = els.stage3JudgeSelect?.value || "";
        const sightUid = els.sightJudgeSelect?.value || "";
        if (!stage1Uid || !stage2Uid || !stage3Uid || !sightUid) {
          if (els.assignmentsError) {
            els.assignmentsError.textContent = "Select all judge assignments.";
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
      els.adminSchoolManageSelect.addEventListener("change", () => {
        const hasSelection = Boolean(els.adminSchoolManageSelect?.value);
        if (els.adminSchoolManageEditBtn) {
          els.adminSchoolManageEditBtn.disabled = !hasSelection;
        }
        if (els.adminSchoolManageDeleteBtn) {
          els.adminSchoolManageDeleteBtn.disabled = !hasSelection;
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
        if (els.schoolResult) {
          els.schoolResult.textContent = `Imported ${result.count} schools.`;
        }
      });
    }

    if (els.provisionForm) {
      els.provisionForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = els.provisionEmailInput?.value.trim() || "";
        const name = els.provisionNameInput?.value.trim() || "";
        const role = els.provisionRoleSelect?.value || "judge";
        const schoolId = els.provisionSchoolSelect?.value || null;
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
        renderDirectorAssignmentsDirectory();
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
        els.directorAssignBtn.disabled = true;
        try {
          await assignDirectorSchool({ directorUid: director.uid, schoolId });
          if (els.directorManageResult) {
            const schoolName = getSchoolNameById(state.admin.schoolsList, schoolId) || schoolId;
            els.directorManageResult.textContent = `Assigned ${director.displayName || director.email || director.uid} to ${schoolName}.`;
          }
        } catch (error) {
          console.error("assignDirectorSchool failed", error);
          if (els.directorManageResult) {
            els.directorManageResult.textContent = error?.message || "Unable to assign director.";
          }
        } finally {
          els.directorAssignBtn.disabled = false;
        }
      });
    }
    if (els.directorUnassignBtn) {
      els.directorUnassignBtn.addEventListener("click", async () => {
        const director = getSelectedDirectorForAdmin();
        if (!director || !director.schoolId) return;
        const label = director.displayName || director.email || director.uid;
        if (!confirmUser(`Remove ${label} from their school assignment?`)) return;
        els.directorUnassignBtn.disabled = true;
        try {
          await unassignDirectorSchool({ directorUid: director.uid });
          if (els.directorManageResult) {
            els.directorManageResult.textContent = `Removed ${label} from school assignment.`;
          }
        } catch (error) {
          console.error("unassignDirectorSchool failed", error);
          if (els.directorManageResult) {
            els.directorManageResult.textContent = error?.message || "Unable to remove director.";
          }
        } finally {
          els.directorUnassignBtn.disabled = false;
        }
      });
    }
  };
}
