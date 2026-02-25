import {
  GRADE_VALUES,
  JUDGE_POSITIONS,
  STATUSES,
} from "../state.js";
import { mapOverallLabelFromTotal, normalizeGrade } from "./utils.js";

const gradeOneLookup = window.GradeOneLookup;
const GRADE_ONE_MAP = gradeOneLookup?.GRADE_ONE_MAP || {};
const computeGradeOneKey = gradeOneLookup?.computeGradeOneKey || (() => "");

export function calculateCaptionTotal(captions) {
  return Object.values(captions || {}).reduce((sum, caption) => {
    const score = GRADE_VALUES[caption?.gradeLetter] ?? 0;
    return sum + score;
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
  const stageValues = (stageScores || []).filter((value) => Number.isFinite(value));
  if (normalizedGrade === "I") {
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

export function isSubmissionComplete(submission) {
  if (!submission) return false;
  if (!submission.locked) return false;
  if (submission.status !== STATUSES.submitted) return false;
  if (!submission.audioUrl) return false;
  if (!submission.captions) return false;
  if (Object.keys(submission.captions).length < 7) return false;
  if (!Number.isFinite(submission.captionScoreTotal)) return false;
  if (!Number.isFinite(submission.computedFinalRatingJudge)) return false;
  return true;
}

export function computePacketSummary(grade, submissions) {
  const normalizedGrade = normalizeGrade(grade);
  const requiredPositions =
    normalizedGrade === "I"
      ? [JUDGE_POSITIONS.stage1, JUDGE_POSITIONS.stage2, JUDGE_POSITIONS.stage3]
      : [
          JUDGE_POSITIONS.stage1,
          JUDGE_POSITIONS.stage2,
          JUDGE_POSITIONS.stage3,
          JUDGE_POSITIONS.sight,
        ];

  const requiredComplete = requiredPositions.every((position) =>
    isSubmissionComplete(submissions[position])
  );
  const requiredReleased = requiredPositions.every(
    (position) => submissions[position]?.status === STATUSES.released
  );

  const stageScores = [
    submissions.stage1?.computedFinalRatingJudge,
    submissions.stage2?.computedFinalRatingJudge,
    submissions.stage3?.computedFinalRatingJudge,
  ];
  const sightScore = submissions.sight?.computedFinalRatingJudge;
  const overall = computeOverallPacketRating(normalizedGrade, stageScores, sightScore);

  return {
    grade: normalizedGrade,
    requiredPositions,
    requiredComplete,
    requiredReleased,
    overall,
  };
}
