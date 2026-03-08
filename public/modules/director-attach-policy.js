export function resolveAdminDirectorPersistPrimary(persistPrimary) {
  return typeof persistPrimary === "boolean" ? persistPrimary : false;
}

const ADMIN_RETURN_VIEWS = new Set([
  "preEvent",
  "liveEvent",
  "packets",
  "readiness",
  "settings",
]);

export function resolveAdminDirectorReturnView(view, fallback = "preEvent") {
  const normalizedFallback = ADMIN_RETURN_VIEWS.has(fallback) ? fallback : "preEvent";
  const normalizedView = String(view || "").trim();
  return ADMIN_RETURN_VIEWS.has(normalizedView) ? normalizedView : normalizedFallback;
}
