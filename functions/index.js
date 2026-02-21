const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  COLLECTIONS,
  FIELDS,
  STATUSES,
  FORM_TYPES,
  JUDGE_POSITIONS,
  CAPTION_TEMPLATES,
} = require("./shared/constants");

admin.initializeApp();

setGlobalOptions({ maxInstances: 10 });

function buildDraftText(transcript, label) {
  if (!transcript) return "";
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const snippet = trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
  return `${label}: ${snippet}`;
}

async function assertAdmin(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const userSnap = await admin
    .firestore()
    .collection(COLLECTIONS.users)
    .doc(request.auth.uid)
    .get();
  if (!userSnap.exists || userSnap.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return userSnap.data();
}

function normalizeGrade(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  if (roman.includes(text)) return text;
  const num = Number(text);
  if (!Number.isNaN(num) && num >= 1 && num <= 6) return roman[num - 1];
  return null;
}

const GRADE_ONE_MAP = {
  111: "I",
  112: "I",
  113: "I",
  114: "I",
  115: "I",
  122: "II",
  123: "II",
  222: "II",
  223: "II",
  224: "II",
  225: "II",
  133: "III",
  234: "III",
  332: "III",
  333: "III",
  334: "III",
  335: "III",
  144: "IV",
  345: "IV",
  442: "IV",
  443: "IV",
  444: "IV",
  445: "IV",
  155: "V",
  255: "V",
  355: "V",
  455: "V",
  555: "V",
};

function computeGradeOneKey(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.join("");
}

async function resolvePerformanceGrade(eventId, ensembleId) {
  const db = admin.firestore();
  const ensembleSnap = await db
    .collection(COLLECTIONS.ensembles)
    .doc(ensembleId)
    .get();
  if (ensembleSnap.exists) {
    const grade = normalizeGrade(ensembleSnap.data().performanceGrade);
    if (grade) return grade;
  }

  const scheduleSnap = await db
    .collection(COLLECTIONS.events)
    .doc(eventId)
    .collection(COLLECTIONS.schedule)
    .where(FIELDS.schedule.ensembleId, "==", ensembleId)
    .limit(1)
    .get();

  if (!scheduleSnap.empty) {
    const grade = normalizeGrade(
      scheduleSnap.docs[0].data().performanceGrade
    );
    if (grade) return grade;
  }

  return null;
}

function requiredPositionsForGrade(grade) {
  if (grade === "I") {
    return [
      JUDGE_POSITIONS.stage1,
      JUDGE_POSITIONS.stage2,
      JUDGE_POSITIONS.stage3,
    ];
  }
  return [
    JUDGE_POSITIONS.stage1,
    JUDGE_POSITIONS.stage2,
    JUDGE_POSITIONS.stage3,
    JUDGE_POSITIONS.sight,
  ];
}

function isSubmissionReady(submission) {
  if (!submission) return false;
  if (submission.status !== STATUSES.submitted) return false;
  if (submission.locked !== true) return false;
  if (!submission.audioUrl) return false;
  if (!submission.captions) return false;
  if (Object.keys(submission.captions).length < 7) return false;
  if (typeof submission.captionScoreTotal !== "number") return false;
  if (typeof submission.computedFinalRatingJudge !== "number") return false;
  return true;
}

exports.parseTranscript = onCall(async (request) => {
  const data = request.data || {};
  const formType = data.formType;
  const transcript = data.transcript || "";

  if (![FORM_TYPES.stage, FORM_TYPES.sight].includes(formType)) {
    throw new HttpsError("invalid-argument", "Invalid formType.");
  }

  const template = CAPTION_TEMPLATES[formType] || [];
  const captions = template.reduce((acc, item) => {
    acc[item.key] = {
      label: item.label,
      draft: buildDraftText(transcript, item.label),
    };
    return acc;
  }, {});

  logger.info("parseTranscript", { formType, captionCount: template.length });

  return { captions, formType };
});

exports.releasePacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = data.eventId;
  const ensembleId = data.ensembleId;

  if (!eventId || !ensembleId) {
    throw new HttpsError("invalid-argument", "eventId and ensembleId required.");
  }

  const grade = await resolvePerformanceGrade(eventId, ensembleId);
  if (!grade) {
    throw new HttpsError(
      "failed-precondition",
      "Performance grade required."
    );
  }

  const db = admin.firestore();
  const positions = requiredPositionsForGrade(grade);
  const submissionDocs = await Promise.all(
    positions.map((position) => {
      const submissionId = `${eventId}_${ensembleId}_${position}`;
      return db.collection(COLLECTIONS.submissions).doc(submissionId).get();
    })
  );

  const submissions = submissionDocs.map((docSnap) =>
    docSnap.exists ? docSnap.data() : null
  );

  if (!submissions.every((submission) => isSubmissionReady(submission))) {
    throw new HttpsError(
      "failed-precondition",
      "All required submissions must be complete, locked, and submitted."
    );
  }

  if (grade === "I") {
    const stageScores = [
      submissions[0]?.computedFinalRatingJudge,
      submissions[1]?.computedFinalRatingJudge,
      submissions[2]?.computedFinalRatingJudge,
    ];
    if (stageScores.some((value) => typeof value !== "number")) {
      throw new HttpsError(
        "failed-precondition",
        "Grade I packet missing stage ratings."
      );
    }
    const key = computeGradeOneKey(stageScores);
    if (!GRADE_ONE_MAP[key]) {
      throw new HttpsError(
        "failed-precondition",
        `Grade I mapping missing for key ${key}.`
      );
    }
  }

  const batch = db.batch();
  submissionDocs.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      [FIELDS.submissions.status]: STATUSES.released,
      releasedAt: admin.firestore.FieldValue.serverTimestamp(),
      releasedBy: request.auth.uid,
    });
  });
  await batch.commit();
  return { released: true, grade };
});

exports.unreleasePacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = data.eventId;
  const ensembleId = data.ensembleId;

  if (!eventId || !ensembleId) {
    throw new HttpsError("invalid-argument", "eventId and ensembleId required.");
  }

  const grade = await resolvePerformanceGrade(eventId, ensembleId);
  if (!grade) {
    throw new HttpsError(
      "failed-precondition",
      "Performance grade required."
    );
  }

  const db = admin.firestore();
  const positions = requiredPositionsForGrade(grade);
  const submissionDocs = await Promise.all(
    positions.map((position) => {
      const submissionId = `${eventId}_${ensembleId}_${position}`;
      return db.collection(COLLECTIONS.submissions).doc(submissionId).get();
    })
  );

  const submissions = submissionDocs.map((docSnap) =>
    docSnap.exists ? docSnap.data() : null
  );

  if (
    !submissions.every((submission) => submission?.status === STATUSES.released)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "All required submissions must be released to unrelease."
    );
  }

  const batch = db.batch();
  submissionDocs.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      [FIELDS.submissions.status]: STATUSES.submitted,
      releasedAt: admin.firestore.FieldValue.delete(),
      releasedBy: admin.firestore.FieldValue.delete(),
    });
  });
  await batch.commit();
  return { released: false, grade };
});

exports.unlockSubmission = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = data.eventId;
  const ensembleId = data.ensembleId;
  const judgePosition = data.judgePosition;

  if (!eventId || !ensembleId || !judgePosition) {
    throw new HttpsError(
      "invalid-argument",
      "eventId, ensembleId, and judgePosition required."
    );
  }

  const submissionId = `${eventId}_${ensembleId}_${judgePosition}`;
  const submissionRef = admin
    .firestore()
    .collection(COLLECTIONS.submissions)
    .doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (!submissionSnap.exists) {
    throw new HttpsError("not-found", "Submission not found.");
  }

  const submission = submissionSnap.data();
  if (submission.status !== STATUSES.submitted) {
    throw new HttpsError(
      "failed-precondition",
      "Only submitted packets can be unlocked."
    );
  }

  await submissionRef.update({
    [FIELDS.submissions.locked]: false,
    unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
    unlockedBy: request.auth.uid,
  });
  return { locked: false };
});

exports.lockSubmission = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = data.eventId;
  const ensembleId = data.ensembleId;
  const judgePosition = data.judgePosition;

  if (!eventId || !ensembleId || !judgePosition) {
    throw new HttpsError(
      "invalid-argument",
      "eventId, ensembleId, and judgePosition required."
    );
  }

  const submissionId = `${eventId}_${ensembleId}_${judgePosition}`;
  const submissionRef = admin
    .firestore()
    .collection(COLLECTIONS.submissions)
    .doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (!submissionSnap.exists) {
    throw new HttpsError("not-found", "Submission not found.");
  }

  await submissionRef.update({
    [FIELDS.submissions.locked]: true,
  });
  return { locked: true };
});
