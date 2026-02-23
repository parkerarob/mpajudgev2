import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "./modules/firestore.js";
import { auth, db, firebaseConfig } from "./firebase.js";
import { COLLECTIONS, state } from "./state.js";
import { watchSchools } from "./modules/admin.js";
import {
  resetJudgeState,
  resetTestState,
  setTestMode,
} from "./modules/judge.js";
import { startAutosaveLoop } from "./modules/autosave.js";
import {
  bindAuthHandlers,
  bindAdminHandlers,
  bindAppHandlers,
  bindDirectorHandlers,
  bindJudgeHandlers,
  closeAuthModal,
  handleHashChange,
  hideSessionExpiredModal,
  refreshSchoolDropdowns,
  renderDirectorProfile,
  setAuthView,
  setDirectorEntryHint,
  setDirectorEntryStatusLabel,
  setDirectorSaveStatus,
  setMainInteractionDisabled,
  setRoleHint,
  resetTestUI,
  setTestModeUI,
  showSessionExpiredModal,
  startWatchers,
  stopWatchers,
  updateRoleUI,
  updateAuthUI,
  updateConnectivityUI,
  initTabs,
  setTab,
} from "./modules/ui.js";
import { hasUnsavedChanges } from "./modules/navigation.js";

bindAuthHandlers();
bindAdminHandlers();
bindJudgeHandlers();
bindDirectorHandlers();
bindAppHandlers();
startAutosaveLoop();

initTabs();

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
});
window.addEventListener("online", updateConnectivityUI);
window.addEventListener("offline", updateConnectivityUI);
updateConnectivityUI();

window.addEventListener("hashchange", handleHashChange);
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

refreshSchoolDropdowns();
watchSchools(() => {
  refreshSchoolDropdowns();
});
handleHashChange();

onAuthStateChanged(auth, async (user) => {
  state.auth.currentUser = user;
  updateAuthUI();

  if (!user) {
    const working = hasUnsavedChanges();
    if (working) {
      state.auth.sessionExpiredLocked = true;
      stopWatchers();
      showSessionExpiredModal();
      setMainInteractionDisabled(true);
      handleHashChange();
      return;
    }
    state.auth.userProfile = null;
    updateRoleUI();
    resetJudgeState();
    stopWatchers();
    setTestMode(false);
    setTestModeUI(false);
    resetTestState();
    resetTestUI();
    state.director.selectedEventId = null;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    state.director.entryExists = false;
    state.director.ensemblesCache = [];
    setDirectorEntryHint("");
    setDirectorSaveStatus("");
    setDirectorEntryStatusLabel("Draft");
    setAuthView("signIn");
    closeAuthModal();
    window.location.hash = "";
    handleHashChange();
    return;
  }

  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(userRef);
  state.auth.userProfile = snap.exists() ? snap.data() : null;
  if (state.auth.sessionExpiredLocked) {
    state.auth.sessionExpiredLocked = false;
    hideSessionExpiredModal();
    setMainInteractionDisabled(false);
  }
  updateRoleUI();
  if (state.auth.userProfile) {
    if (state.auth.userProfile.role === "admin") {
      setTab("admin");
    } else if (state.auth.userProfile.role === "judge") {
      setTab("judge");
    } else if (state.auth.userProfile.role === "director") {
      setTab("director");
    }
    startWatchers();
    renderDirectorProfile();
  } else {
    stopWatchers();
    resetJudgeState();
  }
  closeAuthModal();
  handleHashChange();
});

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  setRoleHint("Update firebaseConfig in app.js to match your project.");
}
