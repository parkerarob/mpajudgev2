import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "./modules/firestore.js";
import { auth, db, firebaseConfig } from "./firebase.js";
import { COLLECTIONS, els, state } from "./state.js";
import { watchSchools } from "./modules/admin.js";
import { startAutosaveLoop } from "./modules/autosave.js";
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

const VERSION_CHECK_INTERVAL_MS = 60_000;
const VERSION_CHECK_PATH = "/version.json";
const AUTH_INIT_DELAY_MS = 200;

let versionCheckBaseline = null;
let versionCheckTimerId = null;
let versionReloadTriggered = false;
let versionReloadPending = false;
let authInitTimeoutId = null;
let schoolDropdownsUnsub = null;

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPublicProgram(snapshot) {
  const renderInto = ({
    cardEl,
    bodyEl,
    statusEl,
    titleEl,
    metaEl,
    updatedEl,
    emptyTitle = "South Site Program",
    hideWhenEmpty = true,
  } = {}) => {
    if (!bodyEl) return;
    if (!snapshot?.published || !Array.isArray(snapshot.sections) || !snapshot.sections.length) {
      if (cardEl && hideWhenEmpty) cardEl.hidden = true;
      bodyEl.innerHTML = "";
      if (titleEl) titleEl.textContent = emptyTitle;
      if (metaEl) metaEl.textContent = "Published event program";
      if (updatedEl) updatedEl.textContent = "";
      if (statusEl) statusEl.textContent = "Program";
      return;
    }
    if (cardEl) cardEl.hidden = false;
    if (statusEl) {
      statusEl.textContent = "Published Program";
    }
    if (titleEl) {
      titleEl.textContent = String(snapshot.eventName || emptyTitle);
    }
    if (metaEl) {
      const meta = [snapshot.dateLabel, snapshot.venueName, snapshot.venueCity].filter(Boolean).join(" - ");
      metaEl.textContent = meta || "Published event program";
    }
    if (updatedEl) {
      const updatedAt = snapshot.updatedAt?.toDate?.() || null;
      updatedEl.textContent = updatedAt
        ? `Updated ${updatedAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "";
    }
    bodyEl.innerHTML = sectionHtml;
  };

  const sectionHtml = snapshot.sections.map((section) => {
    const entriesHtml = (Array.isArray(section.entries) ? section.entries : []).map((entry) => {
      const ensembleLabel = [entry.schoolName, entry.ensembleName].filter(Boolean).join(" ").trim();
      const programHtml = Array.isArray(entry.programLines) && entry.programLines.length
        ? entry.programLines.map((line) => `<div class="public-program-line">${escapeHtml(line)}</div>`).join("")
        : `<div class="public-program-line public-program-muted">Program not submitted</div>`;
      return `
        <article class="public-program-entry">
          <div class="public-program-time">${escapeHtml(entry.timeLabel || "Time TBD")}</div>
          <div class="public-program-grade">${entry.grade ? `Grade: ${escapeHtml(entry.grade)}` : ""}</div>
          <div class="public-program-ensemble">${escapeHtml(ensembleLabel || "Ensemble")}</div>
          <div class="public-program-director">${entry.directorName ? `Director(s): ${escapeHtml(entry.directorName)}` : "Director(s): Not listed"}</div>
          ${programHtml}
        </article>
      `;
    }).join("");
    return `
      <section class="public-program-day">
        <h3>${escapeHtml(section.heading || "Schedule")}</h3>
        ${entriesHtml}
      </section>
    `;
  }).join("");
  renderInto({
    cardEl: els.publicProgramCard,
    bodyEl: els.publicProgramBody,
    statusEl: els.publicProgramStatus,
    titleEl: els.publicProgramTitle,
    metaEl: els.publicProgramMeta,
    updatedEl: els.publicProgramUpdated,
    emptyTitle: "South Site Program",
    hideWhenEmpty: true,
  });
  renderInto({
    cardEl: els.directorProgramSection,
    bodyEl: els.directorProgramBody,
    statusEl: els.directorProgramStatus,
    titleEl: els.directorProgramTitle,
    metaEl: els.directorProgramMeta,
    updatedEl: els.directorProgramUpdated,
    emptyTitle: "Event Program",
    hideWhenEmpty: false,
  });
}

async function loadPublicProgram() {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.publicPrograms, "homepage"));
    if (!snap.exists()) {
      renderPublicProgram(null);
      return;
    }
    renderPublicProgram(snap.data());
  } catch (error) {
    console.warn("Public program load skipped", error);
    renderPublicProgram(null);
  }
}

function ensureSchoolDropdownsWatcher() {
  if (schoolDropdownsUnsub) return;
  schoolDropdownsUnsub = watchSchools(() => {
    refreshSchoolDropdowns();
  });
}

async function getVersionManifest() {
  const url = `${VERSION_CHECK_PATH}?vcheck=${Date.now()}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) {
    throw new Error(`Version check failed for ${VERSION_CHECK_PATH}: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || !payload.buildId) {
    throw new Error("Version check skipped: missing buildId in version manifest");
  }
  return payload;
}

async function triggerVersionReload() {
  if (versionReloadTriggered) return;
  versionReloadTriggered = true;
  if ("caches" in window) {
    try {
      const cacheKeys = await window.caches.keys();
      await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
    } catch (error) {
      console.warn("Cache clear before reload failed", error);
    }
  }
  const url = new URL(window.location.href);
  url.searchParams.set("refresh", String(Date.now()));
  window.location.replace(url.toString());
}

async function runVersionCheck({ initial = false } = {}) {
  try {
    const next = await getVersionManifest();
    if (!versionCheckBaseline) {
      versionCheckBaseline = next;
      return;
    }
    const changed = versionCheckBaseline.buildId !== next.buildId;
    if (!changed) return;
    if (initial) {
      versionCheckBaseline = next;
      return;
    }
    if (hasUnsavedChanges()) {
      versionReloadPending = true;
      console.info("Update detected, waiting for unsaved changes to clear before reload.");
      return;
    }
    versionReloadPending = false;
    await triggerVersionReload();
  } catch (error) {
    console.warn("Version check skipped", error);
  }
}

function startVersionChecks() {
  if (versionCheckTimerId) return;
  runVersionCheck({ initial: true });
  versionCheckTimerId = window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    if (versionReloadPending && !hasUnsavedChanges()) {
      triggerVersionReload();
      return;
    }
    runVersionCheck();
  }, VERSION_CHECK_INTERVAL_MS);
}

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (versionReloadPending && !hasUnsavedChanges()) {
      triggerVersionReload();
      return;
    }
    runVersionCheck();
  }
});

bindAuthHandlers();
bindAdminHandlers();
if (state.app.features?.enableJudgeOpen !== false) {
  bindJudgeOpenHandlers();
}
bindDirectorHandlers();
bindAppHandlers();

initTabs();

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
});
window.addEventListener("online", updateConnectivityUI);
window.addEventListener("offline", updateConnectivityUI);
updateConnectivityUI();
startAutosaveLoop();
loadPublicProgram();

window.addEventListener("public-program-updated", (event) => {
  renderPublicProgram(event?.detail || null);
});

window.addEventListener("hashchange", handleHashChange);
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

refreshSchoolDropdowns();
ensureSchoolDropdownsWatcher();
// Defer handleHashChange until after auth has run (avoids race and blank state on Chrome/Mac)
// handleHashChange is invoked from the auth callback (handleSignedOut or signed-in branch).

function handleSignedOut() {
  stopOpenRecording();
  stopOpenLevelMeter();
  document.body.classList.remove("judge-open-recording-safe");
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
  ensureSchoolDropdownsWatcher();
  state.director.selectedEventId = null;
  state.director.adminViewSchoolId = null;
  state.director.adminLaunchContext = null;
  state.director.selectedEnsembleId = null;
  state.director.activePath = null;
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
}

onAuthStateChanged(auth, async (user) => {
  try {
    state.auth.currentUser = user;
    state.auth.profileLoading = Boolean(user);
    updateAuthUI();

    if (!user) {
      if (!state.auth.authInitialized) {
        if (!authInitTimeoutId) {
          authInitTimeoutId = window.setTimeout(() => {
            if (!state.auth.currentUser && !state.auth.authInitialized) {
              state.auth.authInitialized = true;
              handleSignedOut();
              startVersionChecks();
            }
          }, AUTH_INIT_DELAY_MS);
        }
        return;
      }
      handleSignedOut();
      return;
    }

    if (!state.auth.authInitialized) {
      state.auth.authInitialized = true;
      if (authInitTimeoutId) {
        window.clearTimeout(authInitTimeoutId);
        authInitTimeoutId = null;
      }
      startVersionChecks();
    }

    closeAuthModal();

    if (state.subscriptions.schools) {
      state.subscriptions.schools();
      state.subscriptions.schools = null;
    }

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
      const rawRole = String(state.auth.userProfile.role || "").trim();
      const normalizedRole = (() => {
        if (!rawRole) return "";
        const lower = rawRole.toLowerCase();
        if (lower === "admin") return "admin";
        if (lower === "teamlead" || lower === "team_lead" || lower === "team lead") return "teamLead";
        if (lower === "director") return "director";
        if (lower === "judge") return "judge";
        if (lower === "checkin" || lower === "check-in" || lower === "check_in") return "checkin";
        return "";
      })();
      const role =
        normalizedRole ||
        (roles.admin
          ? "admin"
          : roles.teamLead
            ? "teamLead"
            : roles.director
              ? "director"
              : roles.judge
                ? "judge"
                : roles.checkin
                  ? "checkin"
                  : null);
      const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
      const preferJudgeOpen = judgeEnabled && roles.judge === true && role !== "admin";
      const path = window.location.pathname || "";
      const isLegacyJudgePath = path.endsWith("/judge") || path.endsWith("/judge/");
      if (isLegacyJudgePath && role !== "admin") {
        if (judgeEnabled) {
          window.history.replaceState(null, "", "/judge-open#judge-open");
        } else {
          window.history.replaceState(null, "", "/#admin");
        }
      }
      if (preferJudgeOpen) {
        setTab("judge-open");
        if (window.location.hash !== "#judge-open") {
          window.location.hash = "#judge-open";
        }
      } else if (role === "admin") {
        setTab("admin");
        if (window.location.hash !== "#admin") {
          window.location.hash = "#admin";
        }
      } else if (role === "teamLead") {
        setTab("admin");
        if (window.location.hash !== "#admin") {
          window.location.hash = "#admin";
        }
      } else if (role === "judge") {
        if (judgeEnabled) {
          setTab("judge-open");
          if (window.location.hash !== "#judge-open") {
            window.location.hash = "#judge-open";
          }
        } else {
          setTab("admin", { force: true });
          if (window.location.hash !== "#admin") {
            window.location.hash = "#admin";
          }
        }
      } else if (role === "director") {
        setTab("director");
      } else if (role === "checkin") {
        setTab("checkin");
        if (window.location.hash !== "#checkin") {
          window.location.hash = "#checkin";
        }
      }
      startWatchers();
      renderDirectorProfile();
      if (judgeEnabled && (preferJudgeOpen || role === "judge")) {
        restoreOpenPacketFromPrefs();
      }
    } else {
      stopWatchers();
    }
    closeAuthModal();
    handleHashChange();
  } catch (err) {
    console.error("Auth state handler error", err);
    state.auth.authInitialized = true;
    state.auth.profileLoading = false;
    if (authInitTimeoutId) {
      window.clearTimeout(authInitTimeoutId);
      authInitTimeoutId = null;
    }
    updateAuthUI();
    updateRoleUI();
    handleHashChange();
  }
});

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  setRoleHint("Update firebaseConfig in app.js to match your project.");
}
