import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "./modules/firestore.js";
import { auth, db, firebaseConfig } from "./firebase.js";
import { COLLECTIONS, state } from "./state.js";
import { watchSchools } from "./modules/admin.js";
import { resetJudgeOpenState, stopOpenRecording } from "./modules/judge-open.js";
import {
  bindAuthHandlers,
  bindAdminHandlers,
  bindAppHandlers,
  bindDirectorHandlers,
  bindJudgeOpenHandlers,
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
  showSessionExpiredModal,
  startWatchers,
  stopOpenLevelMeter,
  stopWatchers,
  restoreOpenPacketFromPrefs,
  updateRoleUI,
  updateAuthUI,
  updateConnectivityUI,
  initTabs,
  setTab,
} from "./modules/ui.js";
import { hasUnsavedChanges } from "./modules/navigation.js";

const params = new URLSearchParams(window.location.search);
const userAgent = navigator.userAgent || "";
const isChrome = /Chrome|CriOS/.test(userAgent) && !/Edg|OPR/.test(userAgent);
if (params.has("safe") || isChrome) {
  document.body.classList.add("safe-render");
}

bindAuthHandlers();
bindAdminHandlers();
bindJudgeOpenHandlers();
bindDirectorHandlers();
bindAppHandlers();

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

if (window.location.pathname.includes("/judge-open") && window.location.hash !== "#judge-open") {
  window.location.hash = "#judge-open";
}

onAuthStateChanged(auth, async (user) => {
  state.auth.currentUser = user;
  state.auth.profileLoading = Boolean(user);
  updateAuthUI();

  if (!user) {
    stopOpenRecording();
    stopOpenLevelMeter();
    setMainInteractionDisabled(true);
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
    state.auth.profileLoading = false;
    updateRoleUI();
    resetJudgeOpenState();
    stopWatchers();
    state.director.selectedEventId = null;
    state.director.adminViewSchoolId = null;
    state.director.selectedEnsembleId = null;
    state.director.entryDraft = null;
    state.director.entryRef = null;
    state.director.entryExists = false;
    state.director.ensemblesCache = [];
    setDirectorEntryHint("");
    setDirectorSaveStatus("");
    setDirectorEntryStatusLabel("Incomplete");
    setAuthView("signIn");
    closeAuthModal();
    window.location.hash = "";
    if (window.location.pathname.includes("/judge-open")) {
      window.history.replaceState(null, "", "/");
    }
    handleHashChange();
    return;
  }

  closeAuthModal();

  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(userRef);
  state.auth.userProfile = snap.exists() ? snap.data() : null;
  state.auth.profileLoading = false;
  updateAuthUI();
  if (state.auth.sessionExpiredLocked) {
    state.auth.sessionExpiredLocked = false;
    hideSessionExpiredModal();
    setMainInteractionDisabled(false);
  }
  updateRoleUI();
  setMainInteractionDisabled(false);
  if (state.auth.userProfile) {
    const roles = state.auth.userProfile.roles || {};
    const role = state.auth.userProfile.role
      || (roles.admin ? "admin" : roles.director ? "director" : roles.judge ? "judge" : null);
    const preferJudgeOpen = roles.judge === true && role !== "admin";
    const path = window.location.pathname || "";
    const isLegacyJudgePath = path.endsWith("/judge") || path.endsWith("/judge/");
    if (isLegacyJudgePath && role !== "admin") {
      window.history.replaceState(null, "", "/judge-open#judge-open");
    }
    if (preferJudgeOpen) {
      setTab("judge-open");
      if (window.location.hash !== "#judge-open") {
        window.location.hash = "#judge-open";
      }
    } else if (role === "admin") {
      setTab("admin");
    } else if (role === "judge") {
      setTab("judge-open");
      if (window.location.hash !== "#judge-open") {
        window.location.hash = "#judge-open";
      }
    } else if (role === "director") {
      setTab("director");
    }
    startWatchers();
    renderDirectorProfile();
    if (preferJudgeOpen || role === "judge") {
      restoreOpenPacketFromPrefs();
    }
  } else {
    stopWatchers();
  }
  closeAuthModal();
  handleHashChange();
});

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  setRoleHint("Update firebaseConfig in app.js to match your project.");
}
