const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");
const {
  COLLECTIONS,
  FIELDS,
  STATUSES,
  FORM_TYPES,
  JUDGE_POSITIONS,
  CAPTION_TEMPLATES,
} = require("./shared/constants");

admin.initializeApp();

setGlobalOptions({maxInstances: 10});

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const OPENAI_TIMEOUT_MS = 30 * 1000;
const MAX_TRANSCRIPT_CHARS = 12000;

async function fetchWithTimeout(url, options, timeoutMs = OPENAI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeoutId);
  }
}

function fallbackCaption() {
  return "Limited evidence in the recording for this area; focus on consistent fundamentals.";
}

function trimWords(text, maxWords) {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}...`;
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

async function assertRole(request, allowedRoles) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const userSnap = await admin
      .firestore()
      .collection(COLLECTIONS.users)
      .doc(request.auth.uid)
      .get();
  const role = userSnap.exists ? userSnap.data().role : null;
  if (!allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", "Not authorized.");
  }
  return userSnap.data();
}

async function checkRateLimit(uid, key, limit, windowSeconds) {
  const db = admin.firestore();
  const ref = db.collection("rateLimits").doc(uid);
  const now = admin.firestore.Timestamp.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const entry = data?.[key] || {};
    const windowStart = entry.windowStart?.toMillis ? entry.windowStart : null;
    const nowMs = now.toMillis();
    if (!windowStart || nowMs - windowStart.toMillis() > windowSeconds * 1000) {
      tx.set(ref, {[key]: {windowStart: now, count: 1}}, {merge: true});
      return;
    }
    const nextCount = Number(entry.count || 0) + 1;
    if (nextCount > limit) {
      throw new HttpsError(
          "resource-exhausted",
          "Rate limit exceeded. Please wait and try again.",
      );
    }
    tx.set(
        ref,
        {[key]: {windowStart: windowStart, count: nextCount}},
        {merge: true},
    );
  });
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

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
}

function getStoragePathFromUrl(audioUrl) {
  if (!audioUrl) return null;
  try {
    const url = new URL(audioUrl);
    const parts = url.pathname.split("/o/");
    if (parts.length < 2) return null;
    const encodedPath = parts[1].split("?")[0];
    if (!encodedPath) return null;
    return decodeURIComponent(encodedPath);
  } catch (error) {
    return null;
  }
}

const {
  GRADE_ONE_MAP,
  computeGradeOneKey,
} = require("./shared/grade1-lookup");

async function resolvePerformanceGrade(eventId, ensembleId) {
  const db = admin.firestore();
  const entrySnap = await db
      .collection(COLLECTIONS.events)
      .doc(eventId)
      .collection(COLLECTIONS.entries)
      .doc(ensembleId)
      .get();
  if (entrySnap.exists) {
    const grade = normalizeGrade(
        entrySnap.data()[FIELDS.entries.performanceGrade],
    );
    if (grade) return grade;
  }

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
        scheduleSnap.docs[0].data().performanceGrade,
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

exports.parseTranscript = onCall(
    {secrets: [OPENAI_API_KEY], enforceAppCheck: true},
    async (request) => {
      await assertRole(request, ["judge", "admin"]);
      await checkRateLimit(request.auth.uid, "parseTranscript", 20, 60);
      const data = request.data || {};
      const formType = data.formType;
      const transcript = data.transcript || "";

      if (![FORM_TYPES.stage, FORM_TYPES.sight].includes(formType)) {
        throw new HttpsError("invalid-argument", "Invalid formType.");
      }
      if (transcript && transcript.length > MAX_TRANSCRIPT_CHARS) {
        throw new HttpsError(
            "invalid-argument",
            "Transcript is too long. Please shorten it.",
        );
      }

      const template = CAPTION_TEMPLATES[formType] || [];
      const categories = template.map((item) => ({
        key: item.key,
        label: item.label,
      }));

      if (!transcript || !transcript.trim()) {
        const emptyCaptions = template.reduce((acc, item) => {
          acc[item.key] = fallbackCaption();
          return acc;
        }, {});
        return {captions: emptyCaptions, formType};
      }

      const apiKey = OPENAI_API_KEY.value();
      if (!apiKey) {
        throw new HttpsError(
            "failed-precondition",
            "OpenAI API key not configured.",
        );
      }

      const systemPrompt = [
        "You are an adjudicator assistant. Create concise, category-specific captions.",
        "Rules:",
        "- Produce 1-3 sentences per category, 40-80 words max.",
        "- Do not repeat the category label in the text.",
        "- Use only evidence from the transcript; do not invent details.",
        `- If transcript lacks evidence, write: "${fallbackCaption()}".`,
        "Return a JSON object with keys exactly matching the provided category keys.",
      ].join("\n");

      const userPrompt = [
        "Transcript:",
        transcript || "(empty)",
        "",
        "Categories:",
        categories.map((c) => `${c.key}: ${c.label}`).join("\n"),
      ].join("\n");

      let captions = {};
      let draftError = false;
      let responseModel = null;
      let responseId = null;
      let contentSnippet = "";
      try {
        const response = await fetchWithTimeout(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                temperature: 0.4,
                response_format: {type: "json_object"},
                messages: [
                  {role: "system", content: systemPrompt},
                  {role: "user", content: userPrompt},
                ],
              }),
            },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Caption draft failed", {
            status: response.status,
            body: errorText.slice(0, 500),
          });
          draftError = true;
          throw new HttpsError("internal", "Caption drafting failed.");
        }

        const payload = await response.json();
        responseModel = payload?.model || null;
        responseId = payload?.id || null;
        const content = payload?.choices?.[0]?.message?.content || "";
        contentSnippet = content ? content.slice(0, 500) : "";
        try {
          captions = content ? JSON.parse(content) : {};
        } catch (parseError) {
          draftError = true;
          logger.error("parseTranscript JSON parse failed", {
            error: String(parseError),
            uid: request.auth.uid,
            model: responseModel,
            responseId,
            content: contentSnippet,
          });
          captions = {};
        }
      } catch (error) {
        draftError = true;
        logger.error("parseTranscript error", {
          error: String(error),
          uid: request.auth.uid,
          model: responseModel,
          responseId,
          content: contentSnippet,
        });
        captions = {};
      }

      const finalized = template.reduce((acc, item) => {
        const value = captions[item.key];
        const text = typeof value === "string" ? value.trim() : "";
        acc[item.key] = text ? trimWords(text, 80) : fallbackCaption();
        return acc;
      }, {});

      logger.info("parseTranscript", {formType, captionCount: template.length});

      return {captions: finalized, formType, draftError};
    },
);

exports.transcribeSubmissionAudio = onCall(
    {secrets: [OPENAI_API_KEY], enforceAppCheck: true},
    async (request) => {
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }
      await checkRateLimit(request.auth.uid, "transcribeSubmissionAudio", 10, 60);

      const data = request.data || {};
      const eventId = data.eventId;
      const ensembleId = data.ensembleId;
      const judgePosition = data.judgePosition;

      if (!eventId || !ensembleId || !judgePosition) {
        throw new HttpsError(
            "invalid-argument",
            "eventId, ensembleId, and judgePosition required.",
        );
      }

      const apiKey = OPENAI_API_KEY.value();
      if (!apiKey) {
        throw new HttpsError(
            "failed-precondition",
            "OpenAI API key not configured.",
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

      const userSnap = await admin
          .firestore()
          .collection(COLLECTIONS.users)
          .doc(request.auth.uid)
          .get();
      const userRole = userSnap.exists ? userSnap.data().role : null;
      const isAdmin = userRole === "admin";
      const isOwner = submission.judgeUid === request.auth.uid;
      if (!isAdmin && !isOwner) {
        throw new HttpsError(
            "permission-denied",
            "Only the owning judge or an admin can transcribe.",
        );
      }
      if (!isAdmin && submission.locked === true) {
        throw new HttpsError(
            "failed-precondition",
            "Submission is locked. Admin must unlock before transcription.",
        );
      }

      let objectPath = getStoragePathFromUrl(submission.audioUrl);
      if (!objectPath && submission.judgeUid) {
        objectPath = `audio/${submission.judgeUid}/${submissionId}/recording.webm`;
      }
      if (!objectPath) {
        throw new HttpsError(
            "failed-precondition",
            "Unable to resolve audio storage path.",
        );
      }

      const bucket = admin.storage().bucket();
      const file = bucket.file(objectPath);
      const [exists] = await file.exists();
      if (!exists) {
        throw new HttpsError("not-found", "Audio file not found.");
      }

      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size || 0);
      if (size > MAX_AUDIO_BYTES) {
        throw new HttpsError(
            "failed-precondition",
            "Audio file exceeds the 25MB transcription limit.",
        );
      }

      const [buffer] = await file.download();
      const form = new FormData();
      const contentType = metadata.contentType || "audio/webm";
      form.append("model", "gpt-4o-mini-transcribe");
      form.append(
          "file",
          new Blob([buffer], {type: contentType}),
          "recording.webm",
      );

      let response;
      try {
        response = await fetchWithTimeout(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
              body: form,
            },
        );
      } catch (error) {
        logger.error("OpenAI transcription failed", {
          error: String(error),
          submissionId,
        });
        throw new HttpsError("internal", "Transcription failed.");
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("OpenAI transcription failed", {
          status: response.status,
          body: errorText.slice(0, 500),
          submissionId,
        });
        throw new HttpsError("internal", "Transcription failed.");
      }

      const payload = await response.json();
      const transcript = String(payload.text || "").trim();

      await submissionRef.update({
        [FIELDS.submissions.transcript]: transcript,
        [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {transcript};
    },
);

exports.transcribeTestAudio = onCall(
    {secrets: [OPENAI_API_KEY], enforceAppCheck: true},
    async (request) => {
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }
      await checkRateLimit(request.auth.uid, "transcribeTestAudio", 10, 60);

      const data = request.data || {};
      const audioBase64 = String(data.audioBase64 || "").trim();
      const mimeType = String(data.mimeType || "audio/webm").trim();

      if (!audioBase64) {
        throw new HttpsError("invalid-argument", "audioBase64 is required.");
      }

      const buffer = Buffer.from(audioBase64, "base64");
      if (!buffer.length) {
        throw new HttpsError("invalid-argument", "Audio payload is empty.");
      }
      if (buffer.length > MAX_AUDIO_BYTES) {
        throw new HttpsError(
            "failed-precondition",
            "Audio file exceeds the 25MB transcription limit.",
        );
      }

      const apiKey = OPENAI_API_KEY.value();
      if (!apiKey) {
        throw new HttpsError(
            "failed-precondition",
            "OpenAI API key not configured.",
        );
      }

      logger.info("transcribeTestAudio", {
        uid: request.auth.uid,
        bytes: buffer.length,
        mimeType,
      });

      const form = new FormData();
      form.append("model", "gpt-4o-mini-transcribe");
      form.append(
          "file",
          new Blob([buffer], {type: mimeType || "audio/webm"}),
          "recording.webm",
      );

      let response;
      try {
        response = await fetchWithTimeout(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
              body: form,
            },
        );
      } catch (error) {
        logger.error("OpenAI test transcription failed", {
          error: String(error),
        });
        throw new HttpsError("internal", "Transcription failed.");
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("OpenAI test transcription failed", {
          status: response.status,
          body: errorText.slice(0, 500),
        });
        throw new HttpsError("internal", "Transcription failed.");
      }

      const payload = await response.json();
      const transcript = String(payload.text || "").trim();

      return {transcript};
    },
);

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
        "Performance grade required.",
    );
  }

  const db = admin.firestore();
  const positions = requiredPositionsForGrade(grade);
  const submissionDocs = await Promise.all(
      positions.map((position) => {
        const submissionId = `${eventId}_${ensembleId}_${position}`;
        return db.collection(COLLECTIONS.submissions).doc(submissionId).get();
      }),
  );

  const submissions = submissionDocs.map((docSnap) =>
    docSnap.exists ? docSnap.data() : null,
  );

  if (!submissions.every((submission) => isSubmissionReady(submission))) {
    throw new HttpsError(
        "failed-precondition",
        "All required submissions must be complete, locked, and submitted.",
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
          "Grade I packet missing stage ratings.",
      );
    }
    const key = computeGradeOneKey(stageScores);
    if (!GRADE_ONE_MAP[key]) {
      throw new HttpsError(
          "failed-precondition",
          `Grade I mapping missing for key ${key}.`,
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
  return {released: true, grade};
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
        "Performance grade required.",
    );
  }

  const db = admin.firestore();
  const positions = requiredPositionsForGrade(grade);
  const submissionDocs = await Promise.all(
      positions.map((position) => {
        const submissionId = `${eventId}_${ensembleId}_${position}`;
        return db.collection(COLLECTIONS.submissions).doc(submissionId).get();
      }),
  );

  const submissions = submissionDocs.map((docSnap) =>
    docSnap.exists ? docSnap.data() : null,
  );

  if (
    !submissions.every((submission) => submission?.status === STATUSES.released)
  ) {
    throw new HttpsError(
        "failed-precondition",
        "All required submissions must be released to unrelease.",
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
  return {released: false, grade};
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
        "eventId, ensembleId, and judgePosition required.",
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
        "Only submitted packets can be unlocked.",
    );
  }

  await submissionRef.update({
    [FIELDS.submissions.locked]: false,
    unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
    unlockedBy: request.auth.uid,
  });
  return {locked: false};
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
        "eventId, ensembleId, and judgePosition required.",
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
  return {locked: true};
});

exports.provisionUser = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const email = String(data.email || "").trim().toLowerCase();
  const displayName = String(data.displayName || "").trim();
  const role = String(data.role || "").trim();
  const rawSchoolId =
    typeof data.schoolId === "string" ? data.schoolId.trim() : "";
  const schoolId = rawSchoolId || null;
  const tempPassword = String(data.tempPassword || "").trim();

  if (!email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }
  if (!["judge", "director"].includes(role)) {
    throw new HttpsError("invalid-argument", "Role must be judge or director.");
  }

  let userRecord;
  let createdAuthUser = false;
  let generatedPassword = "";

  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Failed to look up auth user.");
    }
  }

  if (!userRecord) {
    const password = tempPassword || generateTempPassword();
    generatedPassword = tempPassword ? "" : password;
    userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
    });
    createdAuthUser = true;
  }

  const userRef = admin.firestore().collection(COLLECTIONS.users).doc(userRecord.uid);
  const existingSnap = await userRef.get();
  if (existingSnap.exists && existingSnap.data().role === "admin") {
    throw new HttpsError(
        "failed-precondition",
        "Cannot overwrite an admin user via provisioning.",
    );
  }

  if (role === "director" && schoolId) {
    const schoolSnap = await admin
        .firestore()
        .collection(COLLECTIONS.schools)
        .doc(schoolId)
        .get();
    if (!schoolSnap.exists) {
      throw new HttpsError("failed-precondition", "School not found.");
    }
  }

  await userRef.set(
      {
        [FIELDS.users.role]: role,
        [FIELDS.users.roles]: {
          director: role === "director",
          judge: role === "judge",
          admin: role === "admin",
        },
        [FIELDS.users.schoolId]: role === "director" ? schoolId : null,
        [FIELDS.users.email]: email,
        ...(displayName ? {displayName} : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(existingSnap.exists ? {} : {createdAt: admin.firestore.FieldValue.serverTimestamp()}),
      },
      {merge: true},
  );

  logger.info("provisionUser", {
    uid: userRecord.uid,
    email,
    role,
    createdAuthUser,
  });

  return {
    uid: userRecord.uid,
    email,
    role,
    schoolId: role === "director" ? schoolId : null,
    createdAuthUser,
    generatedPassword: generatedPassword || undefined,
    displayName: displayName || undefined,
  };
});

exports.deleteEnsemble = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const schoolId = String(data.schoolId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  if (!schoolId || !ensembleId) {
    throw new HttpsError("invalid-argument", "schoolId and ensembleId required.");
  }

  const userSnap = await admin
      .firestore()
      .collection(COLLECTIONS.users)
      .doc(request.auth.uid)
      .get();
  const userRole = userSnap.exists ? userSnap.data().role : null;
  const userSchoolId = userSnap.exists ? userSnap.data().schoolId : null;
  const isAdmin = userRole === "admin";
  const isDirector = userRole === "director";
  if (!isAdmin && !(isDirector && userSchoolId === schoolId)) {
    throw new HttpsError("permission-denied", "Not authorized to delete.");
  }

  const db = admin.firestore();
  const ensembleRef = db
      .collection(COLLECTIONS.schools)
      .doc(schoolId)
      .collection(COLLECTIONS.ensembles)
      .doc(ensembleId);
  const ensembleSnap = await ensembleRef.get();
  if (!ensembleSnap.exists) {
    throw new HttpsError("not-found", "Ensemble not found.");
  }

  const eventsSnap = await db.collection(COLLECTIONS.events).get();
  for (const eventDoc of eventsSnap.docs) {
    const entryRef = db
        .collection(COLLECTIONS.events)
        .doc(eventDoc.id)
        .collection(COLLECTIONS.entries)
        .doc(ensembleId);
    const entrySnap = await entryRef.get();
    if (entrySnap.exists) {
      throw new HttpsError(
          "failed-precondition",
          "Event entry exists for this ensemble.",
      );
    }

    const scheduleSnap = await db
        .collection(COLLECTIONS.events)
        .doc(eventDoc.id)
        .collection(COLLECTIONS.schedule)
        .where(FIELDS.schedule.ensembleId, "==", ensembleId)
        .limit(1)
        .get();
    if (!scheduleSnap.empty) {
      throw new HttpsError(
          "failed-precondition",
          "Schedule entries exist for this ensemble.",
      );
    }
  }

  const submissionsSnap = await db
      .collection(COLLECTIONS.submissions)
      .where(FIELDS.submissions.ensembleId, "==", ensembleId)
      .limit(1)
      .get();
  if (!submissionsSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Submissions exist for this ensemble.",
    );
  }

  await ensembleRef.delete();
  return {deleted: true};
});

exports.deleteEvent = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  if (!eventId) {
    throw new HttpsError("invalid-argument", "eventId is required.");
  }

  const db = admin.firestore();
  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }

  const releasedSnap = await db
      .collection(COLLECTIONS.submissions)
      .where(FIELDS.submissions.eventId, "==", eventId)
      .where(FIELDS.submissions.status, "==", STATUSES.released)
      .limit(1)
      .get();
  if (!releasedSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Cannot delete event: released results exist.",
    );
  }

  let lastDoc = null;
  let hasMore = true;
  // Delete non-released submissions for this event.
  while (hasMore) {
    let queryRef = db
        .collection(COLLECTIONS.submissions)
        .where(FIELDS.submissions.eventId, "==", eventId)
        .orderBy(FIELDS.submissions.eventId)
        .limit(400);
    if (lastDoc) queryRef = queryRef.startAfter(lastDoc);
    const snap = await queryRef.get();
    if (snap.empty) {
      hasMore = false;
      break;
    }
    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  if (typeof db.recursiveDelete === "function") {
    await db.recursiveDelete(eventRef);
  } else {
    // Fallback: delete event document only.
    await eventRef.delete();
  }

  return {deleted: true};
});
