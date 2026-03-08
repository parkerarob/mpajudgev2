export const WALKTHROUGH_STEP_KEYS = [
  "rehearsalComplete",
  "judgeAudioCheck",
  "directorVisibilityCheck",
  "releaseGateCheck",
];

export function countCompletedWalkthroughSteps(steps) {
  const source = steps && typeof steps === "object" ? steps : {};
  return WALKTHROUGH_STEP_KEYS.filter(
    (key) => String(source?.[key]?.status || "").trim().toLowerCase() === "complete"
  ).length;
}

export function resolveWalkthroughStatusLabel({ steps } = {}) {
  const completeSteps = countCompletedWalkthroughSteps(steps);
  if (completeSteps >= WALKTHROUGH_STEP_KEYS.length) {
    return "Complete";
  }
  return completeSteps > 0 ? "In Progress" : "Not Started";
}

export function buildWalkthroughSummary({ steps, walkthrough } = {}) {
  const completeSteps = countCompletedWalkthroughSteps(steps);
  const totalSteps = WALKTHROUGH_STEP_KEYS.length;
  const statusLabel = resolveWalkthroughStatusLabel({ steps, walkthrough });
  return {
    completeSteps,
    totalSteps,
    statusLabel,
    summaryText: `Walkthrough: ${statusLabel} · Steps completed: ${completeSteps}/${totalSteps}.`,
  };
}

export function buildFallbackReadinessChecks({
  assignmentsComplete = false,
  isLiveEvent = true,
  walkthroughStepsReady = false,
} = {}) {
  return [
    {
      key: "activeEvent",
      label: "Active event selected",
      pass: true,
      message: "Active event is set.",
    },
    {
      key: "assignmentsComplete",
      label: "All four judge assignments set",
      pass: Boolean(assignmentsComplete),
      message: "All required positions must be assigned.",
    },
    {
      key: "walkthroughComplete",
      label: "Readiness walkthrough is complete",
      pass: isLiveEvent ? Boolean(walkthroughStepsReady) : true,
      message: isLiveEvent ?
        (walkthroughStepsReady ?
          "All walkthrough checkpoints are complete." :
          "Complete all walkthrough checkpoints in Admin > Readiness.") :
        "Walkthrough completion is not required for rehearsal events.",
    },
  ];
}

export function mergeReadinessChecks({ preflightChecks, fallbackChecks } = {}) {
  const liveChecks = Array.isArray(preflightChecks) ? preflightChecks : [];
  const fallback = Array.isArray(fallbackChecks) ? fallbackChecks : [];
  if (!liveChecks.length) return [...fallback];
  const merged = [...liveChecks];
  const existingKeys = new Set(merged.map((item) => String(item?.key || "").trim()));
  fallback.forEach((check) => {
    const key = String(check?.key || "").trim();
    if (!key || existingKeys.has(key)) return;
    merged.push(check);
  });
  return merged;
}

export function summarizeReadinessChecks({ checks = [], preflightPass = false } = {}) {
  const safeChecks = Array.isArray(checks) ? checks : [];
  const passCount = safeChecks.filter((item) => Boolean(item?.pass)).length;
  const total = safeChecks.length;
  const pass = total > 0 ? passCount === total : Boolean(preflightPass);
  return { passCount, total, pass };
}

export function isMissingWalkthroughCallableError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    code.includes("not-found") ||
    code.includes("unimplemented") ||
    message.includes("function not found")
  );
}

export function shouldRetryBulkResetCallable({
  supportState = "unknown",
  checkedAt = 0,
  nowMs = Date.now(),
  retryCooldownMs = 5 * 60 * 1000,
} = {}) {
  if (supportState !== "unavailable") return true;
  const lastChecked = Number(checkedAt || 0);
  return (nowMs - lastChecked) >= retryCooldownMs;
}

export function computeReadinessControlState({
  hasActiveEvent = false,
  readinessInFlight = false,
  isRehearsalEvent = false,
} = {}) {
  if (!hasActiveEvent) {
    return {
      runPreflight: { disabled: true, title: "Set an active event first." },
      cleanupRehearsal: { disabled: true, title: "Set an active event first." },
      walkthroughStart: { disabled: true, title: "Set an active event first." },
      walkthroughReset: { disabled: true, title: "Set an active event first." },
      readinessStepsDisabled: true,
      readinessOpenViewDisabled: true,
    };
  }
  const busy = Boolean(readinessInFlight);
  return {
    runPreflight: {
      disabled: busy,
      title: busy ? "Readiness action in progress." : "",
    },
    cleanupRehearsal: {
      disabled: busy || !isRehearsalEvent,
      title: busy ?
        "Readiness action in progress." :
        (isRehearsalEvent ? "" : "Cleanup is available only for rehearsal events."),
    },
    walkthroughStart: {
      disabled: busy,
      title: busy ? "Readiness action in progress." : "",
    },
    walkthroughReset: {
      disabled: busy,
      title: busy ? "Readiness action in progress." : "",
    },
    readinessStepsDisabled: busy,
    readinessOpenViewDisabled: busy,
  };
}
