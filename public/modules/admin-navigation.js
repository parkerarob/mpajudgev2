const ADMIN_VIEWS = new Set([
  "preEvent",
  "liveEvent",
  "submissions",
  "packets",
  "announcer",
  "readiness",
  "settings",
]);

const ADMIN_VIEW_BY_SEGMENT = {
  "": "preEvent",
  "pre-event": "preEvent",
  "preevent": "preEvent",
  eventchair: "preEvent",
  events: "preEvent",
  live: "liveEvent",
  "live-event": "liveEvent",
  liveevent: "liveEvent",
  chair: "liveEvent",
  logistics: "liveEvent",
  checkin: "liveEvent",
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
  fallback = "preEvent",
} = {}) {
  const normalizedFallback = ADMIN_VIEWS.has(fallback) ? fallback : "preEvent";
  const normalizedView = String(view || "").trim();
  let resolved = ADMIN_VIEWS.has(normalizedView) ? normalizedView : normalizedFallback;
  if (resolved === "liveEvent" && !liveEnabled) {
    resolved = normalizedFallback === "liveEvent" ? "preEvent" : normalizedFallback;
  }
  if (resolved === "settings" && !settingsEnabled) {
    resolved = normalizedFallback === "settings" ? "preEvent" : normalizedFallback;
  }
  return ADMIN_VIEWS.has(resolved) ? resolved : "preEvent";
}

export function resolveAdminViewFromHashSegment(segment, options = {}) {
  const normalized = String(segment || "").trim().toLowerCase();
  const mapped = ADMIN_VIEW_BY_SEGMENT[normalized] || "preEvent";
  return resolveAdminView(mapped, options);
}

export function getAdminHashForView(view) {
  const resolvedView = resolveAdminView(view);
  if (resolvedView === "preEvent") return "#admin";
  if (resolvedView === "liveEvent") return "#admin/live";
  return `#admin/${resolvedView}`;
}
