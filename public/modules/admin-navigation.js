const ADMIN_VIEWS = new Set([
  "dashboard",
  "preEvent",
  "liveEvent",
  "submissions",
  "packets",
  "announcer",
  "readiness",
  "settings",
]);

const ADMIN_VIEW_BY_SEGMENT = {
  "": "dashboard",
  dashboard: "dashboard",
  "pre-event": "preEvent",
  "preevent": "preEvent",
  registrations: "preEvent",
  registration: "preEvent",
  "check-in": "preEvent",
  eventchair: "preEvent",
  events: "preEvent",
  live: "liveEvent",
  "live-event": "liveEvent",
  liveevent: "liveEvent",
  flow: "liveEvent",
  "schedule-flow": "liveEvent",
  "schedule-and-flow": "liveEvent",
  chair: "liveEvent",
  logistics: "liveEvent",
  checkin: "preEvent",
  submissions: "submissions",
  reviews: "submissions",
  queue: "submissions",
  directory: "settings",
  settings: "settings",
  packets: "packets",
  packet: "packets",
  announcer: "announcer",
  announce: "announcer",
  emcee: "announcer",
  readiness: "readiness",
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
  if (resolved === "settings" && !settingsEnabled) {
    resolved = normalizedFallback === "settings" ? "dashboard" : normalizedFallback;
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
  if (resolvedView === "preEvent") return "#admin/registrations";
  if (resolvedView === "liveEvent") return "#admin/flow";
  return `#admin/${resolvedView}`;
}
