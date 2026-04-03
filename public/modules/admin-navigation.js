const ADMIN_VIEWS = new Set([
  "setup",
  "directory",
  "eventPrep",
  "eventDay",
  "announcer",
]);

const ADMIN_VIEW_BY_SEGMENT = {
  "": null,
  dashboard: "eventPrep",
  setup: "setup",
  settings: "setup",
  directory: "directory",
  "pre-event": "eventPrep",
  preevent: "eventPrep",
  registrations: "eventPrep",
  registration: "eventPrep",
  "check-in": "eventPrep",
  checkin: "eventPrep",
  eventchair: "eventPrep",
  events: "eventPrep",
  readiness: "eventPrep",
  "event-prep": "eventPrep",
  eventprep: "eventPrep",
  live: "eventDay",
  "live-event": "eventDay",
  liveevent: "eventDay",
  flow: "eventDay",
  "schedule-flow": "eventDay",
  "schedule-and-flow": "eventDay",
  chair: "eventDay",
  logistics: "eventDay",
  submissions: "eventDay",
  reviews: "eventDay",
  queue: "eventDay",
  results: "eventDay",
  packets: "eventDay",
  packet: "eventDay",
  ratings: "eventDay",
  ratingsummary: "eventDay",
  summary: "eventDay",
  "event-day": "eventDay",
  eventday: "eventDay",
  announcer: "announcer",
  announce: "announcer",
  emcee: "announcer",
};

export function resolveAdminView(view, {
  liveEnabled = true,
  settingsEnabled = true,
  fallback = liveEnabled ? "eventDay" : "eventPrep",
} = {}) {
  const normalizedFallback = ADMIN_VIEWS.has(fallback) ? fallback : (liveEnabled ? "eventDay" : "eventPrep");
  const normalizedView = String(view || "").trim();
  let resolved = ADMIN_VIEWS.has(normalizedView) ? normalizedView : normalizedFallback;
  if (resolved === "eventDay" && !liveEnabled) {
    resolved = normalizedFallback === "eventDay" ? "eventPrep" : normalizedFallback;
  }
  if ((resolved === "setup" || resolved === "directory") && !settingsEnabled) {
    resolved = resolved === normalizedFallback ? (liveEnabled ? "eventDay" : "eventPrep") : normalizedFallback;
    if (resolved === "setup" || resolved === "directory") resolved = liveEnabled ? "eventDay" : "eventPrep";
  }
  return ADMIN_VIEWS.has(resolved) ? resolved : (liveEnabled ? "eventDay" : "eventPrep");
}

export function resolveAdminViewFromHashSegment(segment, options = {}) {
  const normalized = String(segment || "").trim().toLowerCase();
  const mapped = normalized ? (ADMIN_VIEW_BY_SEGMENT[normalized] || "eventPrep") : (options.liveEnabled ? "eventDay" : "eventPrep");
  return resolveAdminView(mapped, options);
}

export function getAdminHashForView(view) {
  const resolvedView = resolveAdminView(view);
  if (resolvedView === "eventPrep") return "#admin/event-prep";
  if (resolvedView === "eventDay") return "#admin/event-day";
  if (resolvedView === "setup") return "#admin/setup";
  if (resolvedView === "directory") return "#admin/directory";
  if (resolvedView === "announcer") return "#admin/announcer";
  return `#admin/${resolvedView}`;
}
