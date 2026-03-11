import { describe, expect, it, vi } from "vitest";

globalThis.window = {
  GradeOneLookup: {
    GRADE_ONE_MAP: {},
    computeGradeOneKey: () => "",
  },
};

vi.mock("../../public/state.js", () => ({
  GRADE_VALUES: {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    F: 5,
  },
  JUDGE_POSITIONS: {
    stage1: "stage1",
    stage2: "stage2",
    stage3: "stage3",
    sight: "sight",
  },
  STATUSES: {
    submitted: "submitted",
  },
}));

const {
  formatAudioDuration,
  getAudioSegmentsDurationSec,
  getSubmissionAudioSegments,
  hasSubmissionAudio,
  isSubmissionComplete,
} = await import("../../public/modules/judge-shared.js");

describe("judge shared audio helpers", () => {
  it("prefers stored audio segments over a single fallback url", () => {
    const segments = getSubmissionAudioSegments({
      audioUrl: "https://example.com/fallback.webm",
      audioSegments: [
        { sessionId: "seg2", label: "Part 2", audioUrl: "https://example.com/seg2.webm", sortOrder: 1 },
        { sessionId: "seg1", label: "Part 1", audioUrl: "https://example.com/seg1.webm", sortOrder: 0 },
      ],
    });

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.id)).toEqual(["seg1", "seg2"]);
    expect(segments[0].audioUrl).toBe("https://example.com/seg1.webm");
  });

  it("falls back to the legacy single audio url when no segments exist", () => {
    const segments = getSubmissionAudioSegments({
      audioUrl: "https://example.com/recording.webm",
      audioDurationSec: 321,
    });

    expect(segments).toEqual([
      {
        id: "recording",
        label: "Recording",
        audioUrl: "https://example.com/recording.webm",
        audioPath: "",
        durationSec: 321,
      },
    ]);
  });

  it("formats audio durations for display", () => {
    expect(formatAudioDuration(65)).toBe("1:05");
    expect(formatAudioDuration(3661)).toBe("1:01:01");
    expect(formatAudioDuration(0)).toBe("");
  });

  it("sums segment durations for a total display value", () => {
    expect(
      getAudioSegmentsDurationSec([
        { durationSec: 61 },
        { durationSec: 122 },
        { durationSec: "bad" },
      ])
    ).toBe(183);
  });

  it("treats segment-backed submissions as complete when all other fields are present", () => {
    const submission = {
      locked: true,
      status: "submitted",
      audioSegments: [
        { sessionId: "seg1", audioUrl: "https://example.com/seg1.webm" },
        { sessionId: "seg2", audioUrl: "https://example.com/seg2.webm" },
      ],
      captions: {
        a: {},
        b: {},
        c: {},
        d: {},
        e: {},
        f: {},
        g: {},
      },
      captionScoreTotal: 14,
      computedFinalRatingJudge: 2,
    };

    expect(hasSubmissionAudio(submission)).toBe(true);
    expect(isSubmissionComplete(submission)).toBe(true);
  });
});
