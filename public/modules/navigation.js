import { state } from "../state.js";
import { hasDirectorUnsavedChanges } from "./director.js";
import { hasJudgeOpenUnsavedChanges } from "./judge-open.js";
import { resolveAdminViewFromHashSegment } from "./admin-navigation.js";

function getProfileRole(profile) {
  if (!profile) return null;
  const rawRole = String(profile.role || "").trim().toLowerCase();
  if (rawRole === "admin") return "admin";
  if (rawRole === "teamlead" || rawRole === "team_lead" || rawRole === "team lead") return "teamLead";
  if (rawRole === "judge") return "judge";
  if (rawRole === "director") return "director";
  if (profile.roles?.admin) return "admin";
  if (profile.roles?.teamLead) return "teamLead";
  if (profile.roles?.judge) return "judge";
  if (profile.roles?.director) return "director";
  return null;
}

export function hasUnsavedChanges() {
  return hasDirectorUnsavedChanges() || hasJudgeOpenUnsavedChanges();
}

export function getDefaultTabForRole(role) {
  const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
  if (role === "admin") return "admin";
  if (role === "teamLead") return "admin";
  if (role === "judge") return judgeEnabled ? "judge-open" : "admin";
  if (role === "director") return "director";
  return null;
}

export function isTabAllowed(tab, role) {
  if (!role) return false;
  const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
  if (role === "admin") return true;
  if (role === "teamLead") return tab === "admin";
  if (role === "judge") {
    if (!judgeEnabled) return tab === "admin";
    return tab === "judge-open";
  }
  return tab === role;
}

export function setTab(tabName, { force } = {}) {
  const role = getProfileRole(state.auth.userProfile);
  if (!force && role && !isTabAllowed(tabName, role)) {
    return { changed: false, reason: "not-allowed", tabName, role };
  }
  if (state.app.currentTab === tabName) {
    return { changed: false, reason: "same", tabName, role };
  }
  const prevTab = state.app.currentTab;
  state.app.currentTab = tabName;
  return { changed: true, tabName, prevTab, role };
}

export function resolveHash(hash) {
  const value = (hash || "").trim();
  const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
  const liveEnabled = state.app.features?.enableAdminLiveEvent !== false;
  const settingsEnabled =
    state.app.features?.enableAdminSettings !== false &&
    state.app.features?.enableAdminDirectory !== false;
  if (value.startsWith("#event/")) {
    const raw = value.replace("#event/", "").trim();
    const [eventIdPart, modePart = ""] = raw.split("/");
    const eventId = (eventIdPart || "").trim();
    const modeRaw = (modePart || "").trim().toLowerCase();
    const viewMode =
      modeRaw === "director-schedule" || modeRaw === "directorschedule"
        ? "directorSchedule"
        : "admin";
    if (eventId) {
      return { type: "event", eventId, viewMode };
    }
  }
  if (value === "#director") return { type: "tab", tab: "director" };
  if (value === "#judge" || value === "#judge-open") {
    if (!judgeEnabled) return { type: "tab", tab: "admin", adminView: "dashboard" };
    return { type: "tab", tab: "judge-open" };
  }
  if (value === "#admin" || value.startsWith("#admin/")) {
    const segment = value.slice("#admin".length).replace(/^\//, "") || "";
    const adminView = resolveAdminViewFromHashSegment(segment, {
      liveEnabled,
      settingsEnabled,
      fallback: "dashboard",
    });
    return { type: "tab", tab: "admin", adminView };
  }
  return { type: "none" };
}
