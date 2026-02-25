import { state } from "../state.js";
import { hasDirectorUnsavedChanges } from "./director.js";
import { hasJudgeOpenUnsavedChanges } from "./judge-open.js";

export function hasUnsavedChanges() {
  return hasDirectorUnsavedChanges() || hasJudgeOpenUnsavedChanges();
}

export function getDefaultTabForRole(role) {
  if (role === "admin") return "admin";
  if (role === "judge") return "judge-open";
  if (role === "director") return "director";
  return null;
}

export function isTabAllowed(tab, role) {
  if (!role) return false;
  if (role === "admin") return true;
  if (role === "judge") {
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
  if (value.startsWith("#event/")) {
    const eventId = value.replace("#event/", "").trim();
    if (eventId) {
      return { type: "event", eventId };
    }
  }
  if (value === "#director") return { type: "tab", tab: "director" };
  if (value === "#judge") return { type: "tab", tab: "judge-open" };
  if (value === "#judge-open") return { type: "tab", tab: "judge-open" };
  if (value === "#admin") return { type: "tab", tab: "admin" };
  return { type: "none" };
}
