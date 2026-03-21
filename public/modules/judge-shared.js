import {
  GRADE_VALUES,
  JUDGE_POSITIONS,
  STATUSES,
} from "../state.js";
import { mapOverallLabelFromTotal, normalizeGrade, normalizeGradeBand } from "./utils.js";

const gradeOneLookup = window.GradeOneLookup;
const GRADE_ONE_MAP = gradeOneLookup?.GRADE_ONE_MAP || {};
const computeGradeOneKey = gradeOneLookup?.computeGradeOneKey || (() => "");

export function calculateCaptionTotal(captions) {
  return Object.values(captions || {}).reduce((sum, caption) => {
    const score = GRADE_VALUES[caption?.gradeLetter] ?? 0;
    return sum + score;
  }, 0);
}

export function getSubmissionAudioSegments(submission) {
  const stored = Array.isArray(submission?.audioSegments) ? submission.audioSegments : [];
  const normalized = stored
    .map((segment, index) => {
      const audioUrl = String(segment?.audioUrl || "").trim();
      const audioPath = String(segment?.audioPath || "").trim();
      if (!audioUrl && !audioPath) return null;
      const durationSec = Number(segment?.durationSec || 0);
      const sortOrder = Number(segment?.sortOrder ?? index);
      return {
        id: String(segment?.sessionId || segment?.id || `segment_${index + 1}`),
        label: String(segment?.label || `Part ${index + 1}`),
        audioUrl,
        audioPath,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (normalized.length) return normalized;

  const fallbackUrl = String(submission?.audioUrl || "").trim();
  const fallbackPath = String(submission?.audioPath || "").trim();
  if (!fallbackUrl && !fallbackPath) return [];
  const durationSec = Number(submission?.audioDurationSec || 0);
  return [
    {
      id: "recording",
      label: "Recording",
      audioUrl: fallbackUrl,
      audioPath: fallbackPath,
      durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    },
  ];
}

export function hasSubmissionAudio(submission) {
  return getSubmissionAudioSegments(submission).length > 0;
}

export function formatAudioDuration(totalSec) {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "";
  const seconds = Math.max(0, Math.floor(totalSec || 0));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function getAudioSegmentsDurationSec(audioSegments = []) {
  return (Array.isArray(audioSegments) ? audioSegments : []).reduce((sum, segment) => {
    const value = Number(segment?.durationSec || 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

export function computeFinalRating(total) {
  if (total >= 7 && total <= 10) return { label: "I", value: 1 };
  if (total >= 11 && total <= 17) return { label: "II", value: 2 };
  if (total >= 18 && total <= 24) return { label: "III", value: 3 };
  if (total >= 25 && total <= 31) return { label: "IV", value: 4 };
  if (total >= 32 && total <= 35) return { label: "V", value: 5 };
  return { label: "N/A", value: null };
}

export function computeOverallPacketRating(grade, stageScores, sightScore) {
  const normalizedGrade = normalizeGrade(grade);
  const normalizedBand = normalizeGradeBand(grade) || normalizedGrade;
  const stageValues = (stageScores || []).filter((value) => Number.isFinite(value));
  if (["I", "II", "I/II"].includes(normalizedBand)) {
    if (stageValues.length !== 3) return { label: "N/A", value: null };
    const key = computeGradeOneKey(stageValues);
    const label = GRADE_ONE_MAP[key] || "N/A";
    return {
      label,
      value: label === "N/A" ? null : label,
      gradeOneKey: key,
    };
  }

  if (stageValues.length !== 3 || !Number.isFinite(sightScore)) {
    return { label: "N/A", value: null };
  }

  const [s1, s2, s3] = stageValues;
  if (s1 === s2 && s2 === s3 && [3, 4, 5].includes(s1)) {
    const unanimousLabel = ["I", "II", "III", "IV", "V"][s1 - 1] || "N/A";
    return { label: unanimousLabel, value: unanimousLabel };
  }

  const total = s1 + s2 + s3 + sightScore;
  const label = mapOverallLabelFromTotal(total);
  return { label, value: label === "N/A" ? null : label };
}

export function isCommentsOnlySubmission(submission) {
  return Boolean(submission?.commentsOnly);
}

export function isCommentsOnlyPacket(submissions = {}) {
  return Object.values(submissions || {}).some((submission) => isCommentsOnlySubmission(submission));
}

export function getCommentsOnlyJudgeRatingLabel(submission) {
  return isCommentsOnlySubmission(submission) ? "CO" : String(submission?.computedFinalRatingLabel || "N/A");
}

export function getCommentsOnlyCaptionTotalLabel(submission) {
  return isCommentsOnlySubmission(submission) ? "CO" : String(submission?.captionScoreTotal ?? 0);
}

export function isSubmissionComplete(submission, { commentsOnly = false } = {}) {
  if (!submission) return false;
  if (!submission.locked) return false;
  if (![STATUSES.submitted, STATUSES.released].includes(submission.status)) return false;
  if (!hasSubmissionAudio(submission)) return false;
  if (!submission.captions) return false;
  if (Object.keys(submission.captions).length < 7) return false;
  if (commentsOnly || isCommentsOnlySubmission(submission)) return true;
  if (!Number.isFinite(submission.captionScoreTotal)) return false;
  if (!Number.isFinite(submission.computedFinalRatingJudge)) return false;
  return true;
}

export function computePacketSummary(grade, submissions) {
  const normalizedGrade = normalizeGrade(grade);
  const normalizedBand = normalizeGradeBand(grade) || normalizedGrade;
  const commentsOnly = isCommentsOnlyPacket(submissions);
  const requiredPositions =
    ["I", "II", "I/II"].includes(normalizedBand)
      ? [JUDGE_POSITIONS.stage1, JUDGE_POSITIONS.stage2, JUDGE_POSITIONS.stage3]
      : [
          JUDGE_POSITIONS.stage1,
          JUDGE_POSITIONS.stage2,
          JUDGE_POSITIONS.stage3,
          JUDGE_POSITIONS.sight,
        ];

  const blockingPositions = requiredPositions.filter((position) =>
    !isSubmissionComplete(submissions[position], { commentsOnly })
  );
  const requiredComplete = blockingPositions.length === 0;
  const requiredReleased = requiredPositions.every(
    (position) => submissions[position]?.status === STATUSES.released
  );

  const stageScores = [
    submissions.stage1?.computedFinalRatingJudge,
    submissions.stage2?.computedFinalRatingJudge,
    submissions.stage3?.computedFinalRatingJudge,
  ];
  const sightScore = submissions.sight?.computedFinalRatingJudge;
  const overall = commentsOnly
    ? { label: "CO", value: "CO" }
    : computeOverallPacketRating(normalizedGrade, stageScores, sightScore);

  return {
    grade: normalizedGrade,
    commentsOnly,
    requiredPositions,
    blockingPositions,
    requiredComplete,
    requiredReleased,
    overall,
  };
}
