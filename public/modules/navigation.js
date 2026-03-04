import { state } from "../state.js";
import { hasDirectorUnsavedChanges } from "./director.js";
import { hasJudgeOpenUnsavedChanges } from "./judge-open.js";

export function hasUnsavedChanges() {
  return hasDirectorUnsavedChanges() || hasJudgeOpenUnsavedChanges();
}

export function getDefaultTabForRole(role) {
  const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
  if (role === "admin") return "admin";
  if (role === "judge") return judgeEnabled ? "judge-open" : "admin";
  if (role === "director") return "director";
  return null;
}

export function isTabAllowed(tab, role) {
  if (!role) return false;
  const judgeEnabled = state.app.features?.enableJudgeOpen !== false;
  if (role === "admin") return true;
  if (role === "judge") {
    if (!judgeEnabled) return tab === "admin";
    return tab === "judge-open";
  }
  return tab === role;
}

export function setTab(tabName, { force } = {}) {
  const role = state.auth.userProfile?.role || null;
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
    const eventId = value.replace("#event/", "").trim();
    if (eventId) {
      return { type: "event", eventId };
    }
  }
  if (value === "#director") return { type: "tab", tab: "director" };
  if (value === "#judge" || value === "#judge-open") {
    if (!judgeEnabled) return { type: "tab", tab: "admin", adminView: "preEvent" };
    return { type: "tab", tab: "judge-open" };
  }
  if (value === "#admin" || value.startsWith("#admin/")) {
    const segment = value.slice("#admin".length).replace(/^\//, "") || "pre-event";
    let adminView =
      segment === "pre-event" ? "preEvent" :
      segment === "preEvent" ? "preEvent" :
      segment === "eventChair" ? "preEvent" :
      segment === "live" ? "liveEvent" :
      segment === "live-event" ? "liveEvent" :
      segment === "liveEvent" ? "liveEvent" :
      segment === "chair" ? "liveEvent" :
      segment === "events" ? "preEvent" :
      segment === "logistics" ? "liveEvent" :
      segment === "checkin" ? "liveEvent" :
      segment === "directory" ? "settings" :
      segment === "settings" ? "settings" :
      segment === "packets" ? "packets" :
      segment === "packet" ? "packets" :
      "preEvent";
    if (adminView === "liveEvent" && !liveEnabled) adminView = "preEvent";
    if (adminView === "settings" && !settingsEnabled) adminView = "preEvent";
    return { type: "tab", tab: "admin", adminView };
  }
  return { type: "none" };
}
