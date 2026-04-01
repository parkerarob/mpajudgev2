const ADMIN_VIEWS = new Set([
  "dashboard",
  "setup",
  "directory",
  "preEvent",
  "liveEvent",
  "results",
  "announcer",
]);

const ADMIN_VIEW_BY_SEGMENT = {
  "": "dashboard",
  dashboard: "dashboard",
  // Setup — event config, judge assignments, schedule import, program export
  setup: "setup",
  settings: "setup",           // legacy alias
  // Directory — schools, users, director assignments
  directory: "directory",
  // Pre-Event — registrations + readiness (merged)
  "pre-event": "preEvent",
  preevent: "preEvent",
  registrations: "preEvent",
  registration: "preEvent",
  "check-in": "preEvent",
  eventchair: "preEvent",
  events: "preEvent",
  readiness: "preEvent",       // legacy alias
  checkin: "preEvent",
  // Live Day — schedule/flow + review queue (merged)
  live: "liveEvent",
  "live-event": "liveEvent",
  liveevent: "liveEvent",
  flow: "liveEvent",
  "schedule-flow": "liveEvent",
  "schedule-and-flow": "liveEvent",
  chair: "liveEvent",
  logistics: "liveEvent",
  submissions: "liveEvent",    // legacy alias
  reviews: "liveEvent",        // legacy alias
  queue: "liveEvent",          // legacy alias
  // Results — packets + ratings + maintenance (merged)
  results: "results",
  packets: "results",          // legacy alias
  packet: "results",           // legacy alias
  ratings: "results",          // legacy alias
  ratingsummary: "results",    // legacy alias
  summary: "results",          // legacy alias
  // Announcer — presentation display (not in main nav)
  announcer: "announcer",
  announce: "announcer",
  emcee: "announcer",
};

export function resolveAdminView(view, {
  liveEnabled = true,
  settingsEnabled = true,
  fallback = "dashboard",
} = {}) {
  const normalizedFallback = ADMIN_VIEWS.has(fallback) ? fallback : "dashboard";
  const normalizedView = String(view || "").trim();
  let resolved = ADMIN_VIEWS.has(normalizedView) ? normalizedView : normalizedFallback;
  if (resolved === "liveEvent" && !liveEnabled) {
    resolved = normalizedFallback === "liveEvent" ? "dashboard" : normalizedFallback;
  }
  if ((resolved === "setup" || resolved === "directory") && !settingsEnabled) {
    resolved =
      resolved === normalizedFallback ? "dashboard" : normalizedFallback;
    if (resolved === "setup" || resolved === "directory") resolved = "dashboard";
  }
  return ADMIN_VIEWS.has(resolved) ? resolved : "dashboard";
}

export function resolveAdminViewFromHashSegment(segment, options = {}) {
  const normalized = String(segment || "").trim().toLowerCase();
  const mapped = ADMIN_VIEW_BY_SEGMENT[normalized] || "dashboard";
  return resolveAdminView(mapped, options);
}

export function getAdminHashForView(view) {
  const resolvedView = resolveAdminView(view);
  if (resolvedView === "dashboard") return "#admin";
  if (resolvedView === "preEvent") return "#admin/pre-event";
  if (resolvedView === "liveEvent") return "#admin/live";
  if (resolvedView === "setup") return "#admin/setup";
  if (resolvedView === "directory") return "#admin/directory";
  if (resolvedView === "results") return "#admin/results";
  return `#admin/${resolvedView}`;
}
