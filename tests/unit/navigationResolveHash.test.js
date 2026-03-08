import { afterEach, describe, expect, it, vi } from "vitest";

const { mockState, defaultFeatures } = vi.hoisted(() => {
  const features = {
    enableJudgeOpen: true,
    enableAdminLiveEvent: true,
    enableAdminSettings: true,
    enableAdminDirectory: true,
  };
  return {
    mockState: {
      app: {
        features: { ...features },
      },
      auth: {
        userProfile: null,
      },
    },
    defaultFeatures: { ...features },
  };
});

vi.mock("../../public/state.js", () => ({
  state: mockState,
}));

vi.mock("../../public/modules/director.js", () => ({
  hasDirectorUnsavedChanges: () => false,
}));

vi.mock("../../public/modules/judge-open.js", () => ({
  hasJudgeOpenUnsavedChanges: () => false,
}));

const { resolveHash } = await import("../../public/modules/navigation.js");

afterEach(() => {
  mockState.app.features = { ...defaultFeatures };
});

describe("resolveHash", () => {
  it("resolves readiness admin route", () => {
    const resolved = resolveHash("#admin/readiness");
    expect(resolved).toEqual({
      type: "tab",
      tab: "admin",
      adminView: "readiness",
    });
  });

  it("falls back to preEvent when live route is disabled", () => {
    mockState.app.features = {
      ...mockState.app.features,
      enableAdminLiveEvent: false,
    };
    const resolved = resolveHash("#admin/live");
    expect(resolved).toEqual({
      type: "tab",
      tab: "admin",
      adminView: "preEvent",
    });
  });

  it("falls back to preEvent when settings/directory route is disabled", () => {
    mockState.app.features = {
      ...mockState.app.features,
      enableAdminSettings: false,
    };
    const resolved = resolveHash("#admin/directory");
    expect(resolved).toEqual({
      type: "tab",
      tab: "admin",
      adminView: "preEvent",
    });
  });

  it("routes judge-open hash to admin when judge-open is disabled", () => {
    mockState.app.features = {
      ...mockState.app.features,
      enableJudgeOpen: false,
    };
    const resolved = resolveHash("#judge-open");
    expect(resolved).toEqual({
      type: "tab",
      tab: "admin",
      adminView: "preEvent",
    });
  });

  it("parses director schedule event hash", () => {
    const resolved = resolveHash("#event/evt_1/director-schedule");
    expect(resolved).toEqual({
      type: "event",
      eventId: "evt_1",
      viewMode: "directorSchedule",
    });
  });
});
