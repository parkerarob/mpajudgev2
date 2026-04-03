export function resolveAdminDirectorPersistPrimary(persistPrimary) {
  return typeof persistPrimary === "boolean" ? persistPrimary : false;
}

const ADMIN_RETURN_VIEWS = new Set([
  "eventPrep",
  "eventDay",
  "setup",
  "directory",
]);

export function resolveAdminDirectorReturnView(view, fallback = "eventPrep") {
  const normalizedFallback = ADMIN_RETURN_VIEWS.has(fallback) ? fallback : "eventPrep";
  const normalizedView = String(view || "").trim();
  return ADMIN_RETURN_VIEWS.has(normalizedView) ? normalizedView : normalizedFallback;
}
