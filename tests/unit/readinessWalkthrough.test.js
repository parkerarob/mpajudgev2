import { describe, expect, it } from "vitest";
import {
  WALKTHROUGH_STEP_KEYS,
  buildFallbackReadinessChecks,
  buildWalkthroughSummary,
  computeReadinessControlState,
  countCompletedWalkthroughSteps,
  isMissingWalkthroughCallableError,
  mergeReadinessChecks,
  summarizeReadinessChecks,
  shouldRetryBulkResetCallable,
  resolveWalkthroughStatusLabel,
} from "../../public/modules/readiness-walkthrough.js";

describe("readiness walkthrough helpers", () => {
  it("exposes a stable 4-step walkthrough key list", () => {
    expect(WALKTHROUGH_STEP_KEYS).toEqual([
      "rehearsalComplete",
      "judgeAudioCheck",
      "directorVisibilityCheck",
      "releaseGateCheck",
    ]);
  });

  it("counts complete steps only", () => {
    const steps = {
      rehearsalComplete: { status: "complete" },
      judgeAudioCheck: { status: "incomplete" },
      directorVisibilityCheck: { status: "COMPLETE" },
    };
    expect(countCompletedWalkthroughSteps(steps)).toBe(2);
  });

  it("resolves Complete only when all steps are complete", () => {
    expect(
      resolveWalkthroughStatusLabel({
        steps: {
          rehearsalComplete: { status: "complete" },
          judgeAudioCheck: { status: "complete" },
          directorVisibilityCheck: { status: "complete" },
          releaseGateCheck: { status: "complete" },
        },
        walkthrough: { status: "complete" },
      })
    ).toBe("Complete");
  });

  it("does not trust stale complete status when no steps are complete", () => {
    expect(
      resolveWalkthroughStatusLabel({
        steps: {},
        walkthrough: { status: "complete" },
      })
    ).toBe("Not Started");
  });

  it("resolves In Progress when steps are complete but walkthrough status not complete", () => {
    expect(
      resolveWalkthroughStatusLabel({
        steps: { rehearsalComplete: { status: "complete" } },
        walkthrough: { status: "in-progress" },
      })
    ).toBe("In Progress");
  });

  it("builds deterministic summary text", () => {
    const summary = buildWalkthroughSummary({
      steps: {
        rehearsalComplete: { status: "complete" },
      },
      walkthrough: { status: "in-progress" },
    });
    expect(summary).toEqual({
      completeSteps: 1,
      totalSteps: 4,
      statusLabel: "In Progress",
      summaryText: "Walkthrough: In Progress · Steps completed: 1/4.",
    });
  });

  it("detects missing callable errors by code and message", () => {
    expect(isMissingWalkthroughCallableError({ code: "functions/not-found" })).toBe(true);
    expect(isMissingWalkthroughCallableError({ code: "functions/unimplemented" })).toBe(true);
    expect(isMissingWalkthroughCallableError({ message: "Function not found: setReadinessWalkthrough" })).toBe(true);
    expect(isMissingWalkthroughCallableError({ code: "functions/internal" })).toBe(false);
  });

  it("builds fallback checks with walkthrough blocker for live events", () => {
    const checks = buildFallbackReadinessChecks({
      assignmentsComplete: true,
      isLiveEvent: true,
      walkthroughStepsReady: false,
    });
    const walkthroughCheck = checks.find((check) => check.key === "walkthroughComplete");
    expect(walkthroughCheck?.pass).toBe(false);
  });

  it("passes walkthrough fallback check automatically for rehearsal events", () => {
    const checks = buildFallbackReadinessChecks({
      assignmentsComplete: true,
      isLiveEvent: false,
      walkthroughStepsReady: false,
    });
    const walkthroughCheck = checks.find((check) => check.key === "walkthroughComplete");
    expect(walkthroughCheck?.pass).toBe(true);
    expect(walkthroughCheck?.message).toContain("not required for rehearsal events");
  });

  it("returns fallback checks when preflight checks are empty", () => {
    const fallback = [{ key: "activeEvent" }, { key: "assignmentsComplete" }];
    expect(mergeReadinessChecks({ preflightChecks: [], fallbackChecks: fallback })).toEqual(fallback);
  });

  it("returns a new array when preflight checks are empty", () => {
    const fallback = [{ key: "activeEvent" }];
    const merged = mergeReadinessChecks({ preflightChecks: [], fallbackChecks: fallback });
    expect(merged).toEqual(fallback);
    expect(merged).not.toBe(fallback);
  });

  it("merges missing fallback checks behind existing preflight checks", () => {
    const preflightChecks = [{ key: "activeEvent" }, { key: "schedulePresent" }];
    const fallbackChecks = [{ key: "activeEvent" }, { key: "walkthroughComplete" }];
    expect(mergeReadinessChecks({ preflightChecks, fallbackChecks })).toEqual([
      { key: "activeEvent" },
      { key: "schedulePresent" },
      { key: "walkthroughComplete" },
    ]);
  });

  it("does not mutate preflight or fallback arrays when merging", () => {
    const preflightChecks = [{ key: "activeEvent" }, { key: "schedulePresent" }];
    const fallbackChecks = [{ key: "walkthroughComplete" }];
    const preflightClone = JSON.parse(JSON.stringify(preflightChecks));
    const fallbackClone = JSON.parse(JSON.stringify(fallbackChecks));
    mergeReadinessChecks({ preflightChecks, fallbackChecks });
    expect(preflightChecks).toEqual(preflightClone);
    expect(fallbackChecks).toEqual(fallbackClone);
  });

  it("summarizes readiness checks from displayed checks, not stale preflight pass", () => {
    const summary = summarizeReadinessChecks({
      checks: [{ key: "a", pass: true }, { key: "b", pass: false }],
      preflightPass: true,
    });
    expect(summary).toEqual({
      passCount: 1,
      total: 2,
      pass: false,
    });
  });

  it("falls back to preflight pass only when check list is empty", () => {
    expect(summarizeReadinessChecks({ checks: [], preflightPass: true }).pass).toBe(true);
    expect(summarizeReadinessChecks({ checks: [], preflightPass: false }).pass).toBe(false);
  });

  it("retries bulk reset callable unless unavailable and within cooldown", () => {
    expect(
      shouldRetryBulkResetCallable({
        supportState: "unknown",
        checkedAt: 0,
        nowMs: 1000,
        retryCooldownMs: 300000,
      })
    ).toBe(true);
    expect(
      shouldRetryBulkResetCallable({
        supportState: "available",
        checkedAt: 1000,
        nowMs: 2000,
        retryCooldownMs: 300000,
      })
    ).toBe(true);
    expect(
      shouldRetryBulkResetCallable({
        supportState: "unavailable",
        checkedAt: 1000,
        nowMs: 2000,
        retryCooldownMs: 300000,
      })
    ).toBe(false);
    expect(
      shouldRetryBulkResetCallable({
        supportState: "unavailable",
        checkedAt: 1000,
        nowMs: 301000,
        retryCooldownMs: 300000,
      })
    ).toBe(true);
    expect(
      shouldRetryBulkResetCallable({
        supportState: "unavailable",
        checkedAt: 1000,
        nowMs: 300999,
        retryCooldownMs: 300000,
      })
    ).toBe(false);
  });

  it("computes disabled readiness controls when no active event", () => {
    const state = computeReadinessControlState({
      hasActiveEvent: false,
      readinessInFlight: false,
      isRehearsalEvent: false,
    });
    expect(state.runPreflight.disabled).toBe(true);
    expect(state.runPreflight.title).toContain("Set an active event");
    expect(state.cleanupRehearsal.disabled).toBe(true);
    expect(state.readinessStepsDisabled).toBe(true);
    expect(state.readinessOpenViewDisabled).toBe(true);
  });

  it("computes live-event cleanup restriction when active and idle", () => {
    const state = computeReadinessControlState({
      hasActiveEvent: true,
      readinessInFlight: false,
      isRehearsalEvent: false,
    });
    expect(state.runPreflight.disabled).toBe(false);
    expect(state.cleanupRehearsal.disabled).toBe(true);
    expect(state.cleanupRehearsal.title).toContain("only for rehearsal events");
    expect(state.walkthroughStart.disabled).toBe(false);
  });

  it("enables rehearsal cleanup when active rehearsal event is idle", () => {
    const state = computeReadinessControlState({
      hasActiveEvent: true,
      readinessInFlight: false,
      isRehearsalEvent: true,
    });
    expect(state.cleanupRehearsal.disabled).toBe(false);
    expect(state.cleanupRehearsal.title).toBe("");
  });

  it("computes global lock state while readiness action is in flight", () => {
    const state = computeReadinessControlState({
      hasActiveEvent: true,
      readinessInFlight: true,
      isRehearsalEvent: true,
    });
    expect(state.runPreflight.disabled).toBe(true);
    expect(state.cleanupRehearsal.disabled).toBe(true);
    expect(state.walkthroughStart.disabled).toBe(true);
    expect(state.readinessStepsDisabled).toBe(true);
    expect(state.readinessOpenViewDisabled).toBe(true);
  });
});
