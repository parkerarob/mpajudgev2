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
const GRADE_VALUES = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  F: 5,
};

async function fetchWithTimeout(url, options, timeoutMs = OPENAI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcribeAudioBuffer(buffer, contentType, apiKey) {
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", new Blob([buffer], {type: contentType}), "audio.webm");
  const response = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    const errorText = await response.text();
    logger.error("transcribeAudioBuffer error", {errorText});
    throw new HttpsError("internal", "Transcription failed.");
  }
  const dataJson = await response.json();
  return String(dataJson.text || "").trim();
}

async function transcribePacketSegmentInternal({packetRef, packet, sessionId, apiKey}) {
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "OpenAI API key not configured.");
  }
  const sessionRef = packetRef.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Session not found.");
  }
  const session = sessionSnap.data();
  await sessionRef.set({
    transcriptStatus: "running",
    transcriptError: "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  let objectPath = session.masterAudioPath || getStoragePathFromUrl(session.masterAudioUrl);
  if (!objectPath && packet.createdByJudgeUid) {
    objectPath = `packet_audio/${packet.createdByJudgeUid}/${packetRef.id}/${sessionId}/master.webm`;
  }

  const bucket = admin.storage().bucket();
  let transcript = "";

  if (objectPath) {
    const file = bucket.file(objectPath);
    const [exists] = await file.exists();
    if (exists) {
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size || 0);
      if (size <= MAX_AUDIO_BYTES) {
        const [buffer] = await file.download();
        const contentType = metadata.contentType || "audio/webm";
        transcript = await transcribeAudioBuffer(buffer, contentType, apiKey);
      }
    }
  }

  if (!transcript) {
    const prefix = `packet_audio/${packet.createdByJudgeUid}/${packetRef.id}/${sessionId}/chunk_`;
    const [files] = await bucket.getFiles({prefix});
    if (!files.length) {
      throw new HttpsError("not-found", "Audio file not found.");
    }
    const sorted = files
        .map((file) => {
          const match = file.name.match(/chunk_(\\d+)\\.webm$/);
          return {
            file,
            index: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER,
          };
        })
        .sort((a, b) => a.index - b.index);
    const parts = [];
    for (const item of sorted) {
      if (!item.file || item.index === Number.MAX_SAFE_INTEGER) continue;
      const [buffer] = await item.file.download();
      const [metadata] = await item.file.getMetadata();
      const contentType = metadata.contentType || "audio/webm";
      const text = await transcribeAudioBuffer(buffer, contentType, apiKey);
      if (text) parts.push(text);
      if (parts.join(" ").length >= MAX_TRANSCRIPT_CHARS) break;
    }
    transcript = parts.join(" ").trim();
  }

  transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  await sessionRef.set({
    transcript,
    transcriptStatus: "complete",
    transcriptError: "",
    transcriptUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {transcript};
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

function detectJudgePositionFromAssignments(assignments, uid) {
  if (!assignments || !uid) return null;
  if (assignments.stage1Uid === uid) return JUDGE_POSITIONS.stage1;
  if (assignments.stage2Uid === uid) return JUDGE_POSITIONS.stage2;
  if (assignments.stage3Uid === uid) return JUDGE_POSITIONS.stage3;
  if (assignments.sightUid === uid) return JUDGE_POSITIONS.sight;
  return null;
}

function normalizeOpenPacketJudgePosition(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  return Object.values(JUDGE_POSITIONS).includes(candidate) ? candidate : "";
}

async function resolveActiveEventAssignmentForUser(uid) {
  if (!uid) return null;
  const db = admin.firestore();
  const activeSnap = await db
      .collection(COLLECTIONS.events)
      .where(FIELDS.events.isActive, "==", true)
      .limit(2)
      .get();
  if (activeSnap.empty) return null;
  if (activeSnap.size > 1) {
    throw new HttpsError(
        "failed-precondition",
        "Multiple active events found. Set exactly one active event.",
    );
  }
  const eventDoc = activeSnap.docs[0];
  const assignmentsSnap = await db
      .collection(COLLECTIONS.events)
      .doc(eventDoc.id)
      .collection(COLLECTIONS.assignments)
      .doc("positions")
      .get();
  if (!assignmentsSnap.exists) return null;
  const judgePosition = detectJudgePositionFromAssignments(assignmentsSnap.data(), uid);
  if (!judgePosition) return null;
  return {
    eventId: eventDoc.id,
    judgePosition,
  };
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
  if (!isSubmissionFormTypeValid(submission)) return false;
  const scoreCheck = validateSubmissionScoreConsistency(submission);
  if (!scoreCheck.ok) return false;
  return true;
}

function normalizeCaptionGradeLetter(letter) {
  const value = String(letter || "").trim().toUpperCase();
  if (!value) return "";
  return value.replace(/[+-]/g, "");
}

function isSubmissionFormTypeValid(submission) {
  const judgePosition = String(submission?.judgePosition || "");
  const formType = String(submission?.formType || "");
  if (judgePosition === JUDGE_POSITIONS.sight) {
    return formType === FORM_TYPES.sight;
  }
  if ([
    JUDGE_POSITIONS.stage1,
    JUDGE_POSITIONS.stage2,
    JUDGE_POSITIONS.stage3,
  ].includes(judgePosition)) {
    return formType === FORM_TYPES.stage;
  }
  return false;
}

function validateSubmissionScoreConsistency(submission) {
  const captions = submission?.captions;
  if (!captions || typeof captions !== "object") {
    return {ok: false, reason: "captions missing"};
  }
  const captionValues = Object.values(captions);
  if (captionValues.length !== 7) {
    return {ok: false, reason: "caption count invalid"};
  }

  const recomputedTotal = captionValues.reduce((sum, caption) => {
    const letter = normalizeCaptionGradeLetter(caption?.gradeLetter);
    const score = GRADE_VALUES[letter] || 0;
    return sum + score;
  }, 0);

  if (recomputedTotal < 7 || recomputedTotal > 35) {
    return {ok: false, reason: "caption total out of range"};
  }
  if (submission.captionScoreTotal !== recomputedTotal) {
    return {ok: false, reason: "caption total mismatch"};
  }

  const recomputedRating = computeFinalRatingFromTotal(recomputedTotal);
  if (recomputedRating.value == null) {
    return {ok: false, reason: "rating unresolved"};
  }
  if (submission.computedFinalRatingJudge !== recomputedRating.value) {
    return {ok: false, reason: "judge rating mismatch"};
  }
  const currentLabel = String(submission.computedFinalRatingLabel || "").trim();
  if (currentLabel && currentLabel !== recomputedRating.label) {
    return {ok: false, reason: "judge label mismatch"};
  }
  return {ok: true};
}

function calculateCaptionTotal(captions = {}) {
  return Object.values(captions).reduce((sum, caption) => {
    const letter = caption?.gradeLetter || "";
    const score = GRADE_VALUES[letter] || 0;
    return sum + score;
  }, 0);
}

function computeFinalRatingFromTotal(total) {
  if (total >= 7 && total <= 10) return {label: "I", value: 1};
  if (total >= 11 && total <= 17) return {label: "II", value: 2};
  if (total >= 18 && total <= 24) return {label: "III", value: 3};
  if (total >= 25 && total <= 31) return {label: "IV", value: 4};
  if (total >= 32 && total <= 35) return {label: "V", value: 5};
  return {label: "N/A", value: null};
}

async function writePacketAudit(packetRef, {action, fromStatus, toStatus, actor}) {
  const auditRef = packetRef.collection("audit").doc();
  await auditRef.set({
    action,
    fromStatus: fromStatus || null,
    toStatus: toStatus || null,
    actorUid: actor?.uid || null,
    actorRole: actor?.role || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

exports.parseTranscript = onCall(
    {secrets: [OPENAI_API_KEY]},
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
    {secrets: [OPENAI_API_KEY]},
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

exports.createOpenPacket = onCall(async (request) => {
  await assertRole(request, ["judge", "admin"]);
  const data = request.data || {};
  const schoolName = String(data.schoolName || "").trim();
  const ensembleName = String(data.ensembleName || "").trim();
  const formType = data.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
  const useActiveEventDefaults = data.useActiveEventDefaults !== false;
  const assignment = useActiveEventDefaults ?
    await resolveActiveEventAssignmentForUser(request.auth.uid) :
    null;
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc();
  const payload = {
    [FIELDS.packets.status]: "draft",
    [FIELDS.packets.locked]: false,
    [FIELDS.packets.createdByJudgeUid]: request.auth.uid,
    [FIELDS.packets.createdByJudgeName]: data.createdByJudgeName || "",
    [FIELDS.packets.createdByJudgeEmail]: data.createdByJudgeEmail || "",
    [FIELDS.packets.schoolName]: schoolName,
    [FIELDS.packets.ensembleName]: ensembleName,
    [FIELDS.packets.schoolId]: data.schoolId || "",
    [FIELDS.packets.ensembleId]: data.ensembleId || "",
    [FIELDS.packets.ensembleSnapshot]: data.ensembleSnapshot || null,
    [FIELDS.packets.directorEntrySnapshot]: data.directorEntrySnapshot || null,
    [FIELDS.packets.formType]: formType,
    [FIELDS.packets.assignmentEventId]: assignment?.eventId || "",
    [FIELDS.packets.judgePosition]: assignment?.judgePosition || "",
    [FIELDS.packets.assignmentMode]: assignment ? "activeEventDefault" : "open",
    [FIELDS.packets.transcript]: "",
    [FIELDS.packets.transcriptFull]: "",
    [FIELDS.packets.captions]: {},
    [FIELDS.packets.captionScoreTotal]: null,
    [FIELDS.packets.computedFinalRatingJudge]: null,
    [FIELDS.packets.computedFinalRatingLabel]: "N/A",
    [FIELDS.packets.audioSessionCount]: 0,
    [FIELDS.packets.activeSessionId]: null,
    [FIELDS.packets.segmentCount]: 0,
    [FIELDS.packets.tapeDurationSec]: 0,
    [FIELDS.packets.createdAt]: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  };
  await packetRef.set(payload);
  await writePacketAudit(packetRef, {
    action: "create",
    fromStatus: null,
    toStatus: "draft",
    actor: {uid: request.auth.uid, role: "judge"},
  });
  return {packetId: packetRef.id};
});

exports.setUserPrefs = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const prefs = data.preferences || {};
  const next = {};
  const formType = prefs.judgeOpenDefaultFormType;
  if (formType) {
    if (![FORM_TYPES.stage, FORM_TYPES.sight].includes(formType)) {
      throw new HttpsError("invalid-argument", "Invalid form type.");
    }
    next.judgeOpenDefaultFormType = formType;
  }
  if (typeof prefs.lastJudgeOpenPacketId === "string") {
    next.lastJudgeOpenPacketId = prefs.lastJudgeOpenPacketId;
  }
  if (typeof prefs.lastJudgeOpenFormType === "string") {
    next.lastJudgeOpenFormType = prefs.lastJudgeOpenFormType;
  }
  if (typeof prefs.judgeOpenUseActiveEventDefaults === "boolean") {
    next.judgeOpenUseActiveEventDefaults = prefs.judgeOpenUseActiveEventDefaults;
  }
  const userRef = admin.firestore().collection(COLLECTIONS.users).doc(request.auth.uid);
  const userSnap = await userRef.get();
  const currentPrefs = userSnap.exists ? (userSnap.data().preferences || {}) : {};
  await userRef.set({
    preferences: {...currentPrefs, ...next},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true};
});

exports.submitOpenPacket = onCall(async (request) => {
  await assertRole(request, ["judge", "admin"]);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) {
    throw new HttpsError("invalid-argument", "packetId required.");
  }
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) {
    throw new HttpsError("not-found", "Packet not found.");
  }
  const packet = packetSnap.data();
  const userSnap = await admin
      .firestore()
      .collection(COLLECTIONS.users)
      .doc(request.auth.uid)
      .get();
  const userRole = userSnap.exists ? userSnap.data().role : null;
  const isAdmin = userRole === "admin";
  const isOwner = packet.createdByJudgeUid === request.auth.uid;
  if (!isAdmin && !isOwner) {
    throw new HttpsError("permission-denied", "Not authorized.");
  }
  if (!isAdmin && packet.locked === true) {
    throw new HttpsError("failed-precondition", "Packet is locked.");
  }
  const currentStatus = packet.status || "draft";
  if (!["draft", "reopened"].includes(currentStatus)) {
    throw new HttpsError("failed-precondition", "Packet cannot be submitted.");
  }
  const nextSchoolName = String(data.schoolName || packet.schoolName || "");
  const nextEnsembleName = String(data.ensembleName || packet.ensembleName || "");
  const nextSchoolId = String(data.schoolId || packet.schoolId || "");
  const nextEnsembleId = String(data.ensembleId || packet.ensembleId || "");
  const nextEnsembleSnapshot = data.ensembleSnapshot || packet.ensembleSnapshot || null;
  const nextFormType =
    (data.formType === FORM_TYPES.sight || data.formType === FORM_TYPES.stage) ?
      data.formType :
      (packet.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage);
  const useActiveEventDefaults = data.useActiveEventDefaults !== false;
  const assignment = useActiveEventDefaults ?
    await resolveActiveEventAssignmentForUser(request.auth.uid) :
    null;
  const nextStatus = "locked";
  const captions = data.captions || {};
  const captionScoreTotal = calculateCaptionTotal(captions);
  const rating = computeFinalRatingFromTotal(captionScoreTotal);

  const payload = {
    [FIELDS.packets.status]: nextStatus,
    [FIELDS.packets.locked]: true,
    [FIELDS.packets.schoolName]: nextSchoolName,
    [FIELDS.packets.ensembleName]: nextEnsembleName,
    [FIELDS.packets.schoolId]: nextSchoolId,
    [FIELDS.packets.ensembleId]: nextEnsembleId,
    [FIELDS.packets.ensembleSnapshot]: nextEnsembleSnapshot,
    [FIELDS.packets.directorEntrySnapshot]:
      data.directorEntrySnapshot ?? packet.directorEntrySnapshot ?? null,
    [FIELDS.packets.formType]: nextFormType,
    [FIELDS.packets.assignmentEventId]: packet.assignmentMode === "adminOverride" ?
      (packet.assignmentEventId || "") :
      (assignment?.eventId || packet.assignmentEventId || ""),
    [FIELDS.packets.judgePosition]: packet.assignmentMode === "adminOverride" ?
      (packet.judgePosition || "") :
      (assignment?.judgePosition || packet.judgePosition || ""),
    [FIELDS.packets.assignmentMode]: packet.assignmentMode === "adminOverride" ?
      "adminOverride" :
      (assignment ? "activeEventDefault" : (packet.assignmentMode || "open")),
    [FIELDS.packets.transcript]: String(data.transcript || ""),
    [FIELDS.packets.transcriptFull]: String(data.transcriptFull || data.transcript || ""),
    [FIELDS.packets.captions]: captions,
    [FIELDS.packets.captionScoreTotal]: captionScoreTotal,
    [FIELDS.packets.computedFinalRatingJudge]: rating.value,
    [FIELDS.packets.computedFinalRatingLabel]: rating.label,
    [FIELDS.packets.submittedAt]: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.packets.releasedAt]: null,
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  };
  await packetRef.set(payload, {merge: true});
  await writePacketAudit(packetRef, {
    action: "submit",
    fromStatus: currentStatus,
    toStatus: nextStatus,
    actor: {uid: request.auth.uid, role: userRole || "judge"},
  });
  return {packetId, status: nextStatus, autoReleased: false};
});

exports.lockPacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
  const packet = packetSnap.data();
  await packetRef.set({
    [FIELDS.packets.locked]: true,
    [FIELDS.packets.status]: "locked",
    [FIELDS.packets.releasedAt]: null,
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await writePacketAudit(packetRef, {
    action: "lock",
    fromStatus: packet.status || null,
    toStatus: "locked",
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: "locked"};
});

exports.unlockPacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
  const packet = packetSnap.data();
  await packetRef.set({
    [FIELDS.packets.locked]: false,
    [FIELDS.packets.status]: "reopened",
    [FIELDS.packets.releasedAt]: null,
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await writePacketAudit(packetRef, {
    action: "unlock",
    fromStatus: packet.status || null,
    toStatus: "reopened",
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: "reopened"};
});

exports.releaseOpenPacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
  const packet = packetSnap.data();
  if (packet.locked !== true) {
    throw new HttpsError("failed-precondition", "Open packet must be locked before release.");
  }
  await packetRef.set({
    [FIELDS.packets.status]: "released",
    [FIELDS.packets.releasedAt]: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await writePacketAudit(packetRef, {
    action: "release",
    fromStatus: packet.status || null,
    toStatus: "released",
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: "released"};
});

exports.unreleaseOpenPacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
  const packet = packetSnap.data();
  const nextStatus = packet.locked === true ? "locked" : "reopened";
  await packetRef.set({
    [FIELDS.packets.status]: nextStatus,
    [FIELDS.packets.releasedAt]: null,
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await writePacketAudit(packetRef, {
    action: "unrelease",
    fromStatus: packet.status || null,
    toStatus: nextStatus,
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: nextStatus};
});

exports.linkOpenPacketToEnsemble = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = data.packetId;
  const schoolId = data.schoolId;
  const ensembleId = data.ensembleId;
  if (!packetId || !schoolId || !ensembleId) {
    throw new HttpsError("invalid-argument", "packetId, schoolId, ensembleId required.");
  }
  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) {
    throw new HttpsError("not-found", "Packet not found.");
  }
  const schoolRef = db.collection(COLLECTIONS.schools).doc(schoolId);
  const schoolSnap = await schoolRef.get();
  if (!schoolSnap.exists) {
    throw new HttpsError("not-found", "School not found.");
  }
  const ensembleRef = schoolRef.collection("ensembles").doc(ensembleId);
  const ensembleSnap = await ensembleRef.get();
  if (!ensembleSnap.exists) {
    throw new HttpsError("not-found", "Ensemble not found.");
  }
  const schoolName = schoolSnap.data()?.name || schoolId;
  const ensembleName = ensembleSnap.data()?.name || ensembleId;
  const ensembleSnapshot = {
    schoolId,
    schoolName,
    ensembleId,
    ensembleName,
  };
  await packetRef.set({
    [FIELDS.packets.schoolId]: schoolId,
    [FIELDS.packets.ensembleId]: ensembleId,
    [FIELDS.packets.schoolName]: schoolName,
    [FIELDS.packets.ensembleName]: ensembleName,
    [FIELDS.packets.ensembleSnapshot]: ensembleSnapshot,
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await writePacketAudit(packetRef, {
    action: "link",
    fromStatus: packetSnap.data()?.status || null,
    toStatus: packetSnap.data()?.status || null,
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {ok: true};
});

exports.setOpenPacketJudgePosition = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = String(data.packetId || "").trim();
  if (!packetId) {
    throw new HttpsError("invalid-argument", "packetId required.");
  }
  const judgePosition = normalizeOpenPacketJudgePosition(data.judgePosition);
  const assignmentEventId = String(data.assignmentEventId || "").trim();
  const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) {
    throw new HttpsError("not-found", "Packet not found.");
  }
  const packet = packetSnap.data() || {};
  if ((packet.status || "") === "released") {
    throw new HttpsError("failed-precondition", "Revoke packet before changing judge slot.");
  }
  await packetRef.set({
    [FIELDS.packets.judgePosition]: judgePosition,
    [FIELDS.packets.assignmentEventId]: judgePosition ?
      (assignmentEventId || packet.assignmentEventId || "") :
      "",
    [FIELDS.packets.assignmentMode]: judgePosition ? "adminOverride" : "open",
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await writePacketAudit(packetRef, {
    action: "set_judge_position",
    fromStatus: packet.status || null,
    toStatus: packet.status || null,
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {ok: true, judgePosition};
});

exports.deleteOpenPacket = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const packetId = String(data.packetId || "").trim();
  if (!packetId) {
    throw new HttpsError("invalid-argument", "packetId required.");
  }

  const db = admin.firestore();
  const userSnap = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  const userRole = userSnap.exists ? userSnap.data().role : null;
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) {
    throw new HttpsError("not-found", "Packet not found.");
  }
  const packet = packetSnap.data() || {};
  const isAdmin = userRole === "admin";
  const isOwner = packet.createdByJudgeUid === request.auth.uid;
  if (!isAdmin && !isOwner) {
    throw new HttpsError("permission-denied", "Not authorized to delete this packet.");
  }
  const bucket = admin.storage().bucket();

  const sessionsSnap = await packetRef.collection("sessions").get();
  const sessionIds = sessionsSnap.docs.map((docSnap) => docSnap.id);

  for (const sessionId of sessionIds) {
    const sessionRef = packetRef.collection("sessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    const session = sessionSnap.exists ? (sessionSnap.data() || {}) : {};

    const candidatePaths = new Set();
    if (session.masterAudioPath) {
      candidatePaths.add(String(session.masterAudioPath));
    }
    const derivedPath = getStoragePathFromUrl(session.masterAudioUrl);
    if (derivedPath) {
      candidatePaths.add(derivedPath);
    }
    if (packet.createdByJudgeUid) {
      candidatePaths.add(
          `packet_audio/${packet.createdByJudgeUid}/${packetId}/${sessionId}/master.webm`,
      );
    }

    for (const objectPath of candidatePaths) {
      if (!objectPath) continue;
      try {
        await bucket.file(objectPath).delete({ignoreNotFound: true});
      } catch (error) {
        logger.warn("deleteOpenPacket master audio delete failed", {
          packetId,
          sessionId,
          objectPath,
          error: error?.message || String(error),
        });
      }
    }

    if (packet.createdByJudgeUid) {
      const chunkPrefix =
        `packet_audio/${packet.createdByJudgeUid}/${packetId}/${sessionId}/chunk_`;
      try {
        const [files] = await bucket.getFiles({prefix: chunkPrefix});
        await Promise.all(files.map((file) => file.delete({ignoreNotFound: true})));
      } catch (error) {
        logger.warn("deleteOpenPacket chunk delete failed", {
          packetId,
          sessionId,
          chunkPrefix,
          error: error?.message || String(error),
        });
      }
    }
  }

  // Delete packet subcollections first, then packet document.
  await Promise.all(
      sessionsSnap.docs.map((docSnap) => docSnap.ref.delete()),
  );
  const auditSnap = await packetRef.collection("audit").get();
  await Promise.all(
      auditSnap.docs.map((docSnap) => docSnap.ref.delete()),
  );
  await packetRef.delete();

  logger.info("deleteOpenPacket", {
    packetId,
    deletedSessionCount: sessionsSnap.size,
    deletedAuditCount: auditSnap.size,
    actorUid: request.auth.uid,
    actorRole: userRole || null,
  });

  return {ok: true, packetId};
});

exports.transcribePacketSession = onCall(
    {secrets: [OPENAI_API_KEY]},
    async (request) => {
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }
      await checkRateLimit(request.auth.uid, "transcribePacketSession", 10, 60);

      const data = request.data || {};
      const packetId = data.packetId;
      const sessionId = data.sessionId;
      if (!packetId || !sessionId) {
        throw new HttpsError("invalid-argument", "packetId and sessionId required.");
      }

      const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
      const packetSnap = await packetRef.get();
      if (!packetSnap.exists) {
        throw new HttpsError("not-found", "Packet not found.");
      }
      const packet = packetSnap.data();

      const userSnap = await admin
          .firestore()
          .collection(COLLECTIONS.users)
          .doc(request.auth.uid)
          .get();
      const userRole = userSnap.exists ? userSnap.data().role : null;
      const isAdmin = userRole === "admin";
      const isOwner = packet.createdByJudgeUid === request.auth.uid;
      if (!isAdmin && !isOwner) {
        throw new HttpsError(
            "permission-denied",
            "Only the owning judge or an admin can transcribe.",
        );
      }
      if (!isAdmin && packet.locked === true) {
        throw new HttpsError(
            "failed-precondition",
            "Packet is locked. Admin must unlock before transcription.",
        );
      }

      const result = await transcribePacketSegmentInternal({
        packetRef,
        packet,
        sessionId,
        apiKey: OPENAI_API_KEY.value(),
      });
      await packetRef.set({
        [FIELDS.packets.transcript]: result.transcript,
        [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      return {transcript: result.transcript};
    },
);

exports.transcribePacketSegment = onCall(
    {secrets: [OPENAI_API_KEY]},
    async (request) => {
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }
      await checkRateLimit(request.auth.uid, "transcribePacketSegment", 10, 60);
      const data = request.data || {};
      const packetId = data.packetId;
      const sessionId = data.sessionId;
      if (!packetId || !sessionId) {
        throw new HttpsError("invalid-argument", "packetId and sessionId required.");
      }
      const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
      const packetSnap = await packetRef.get();
      if (!packetSnap.exists) {
        throw new HttpsError("not-found", "Packet not found.");
      }
      const packet = packetSnap.data();
      const userSnap = await admin
          .firestore()
          .collection(COLLECTIONS.users)
          .doc(request.auth.uid)
          .get();
      const userRole = userSnap.exists ? userSnap.data().role : null;
      const isAdmin = userRole === "admin";
      const isOwner = packet.createdByJudgeUid === request.auth.uid;
      if (!isAdmin && !isOwner) {
        throw new HttpsError("permission-denied", "Not authorized.");
      }
      if (!isAdmin && packet.locked === true) {
        throw new HttpsError(
            "failed-precondition",
            "Packet is locked. Admin must unlock before transcription.",
        );
      }
      const result = await transcribePacketSegmentInternal({
        packetRef,
        packet,
        sessionId,
        apiKey: OPENAI_API_KEY.value(),
      });
      return {transcript: result.transcript};
    },
);

exports.transcribePacketTape = onCall(
    {secrets: [OPENAI_API_KEY]},
    async (request) => {
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }
      await checkRateLimit(request.auth.uid, "transcribePacketTape", 6, 60);
      const data = request.data || {};
      const packetId = data.packetId;
      if (!packetId) {
        throw new HttpsError("invalid-argument", "packetId required.");
      }
      const packetRef = admin.firestore().collection(COLLECTIONS.packets).doc(packetId);
      const packetSnap = await packetRef.get();
      if (!packetSnap.exists) {
        throw new HttpsError("not-found", "Packet not found.");
      }
      const packet = packetSnap.data();
      const userSnap = await admin
          .firestore()
          .collection(COLLECTIONS.users)
          .doc(request.auth.uid)
          .get();
      const userRole = userSnap.exists ? userSnap.data().role : null;
      const isAdmin = userRole === "admin";
      const isOwner = packet.createdByJudgeUid === request.auth.uid;
      if (!isAdmin && !isOwner) {
        throw new HttpsError("permission-denied", "Not authorized.");
      }
      if (!isAdmin && packet.locked === true) {
        throw new HttpsError(
            "failed-precondition",
            "Packet is locked. Admin must unlock before transcription.",
        );
      }
      const sessionsSnap = await packetRef.collection("sessions").orderBy("startedAt", "asc").get();
      if (sessionsSnap.empty) {
        throw new HttpsError("failed-precondition", "No segments to transcribe.");
      }

      await packetRef.set({
        [FIELDS.packets.transcriptStatus]: "running",
        [FIELDS.packets.transcriptError]: "",
        [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      const mergedParts = [];
      let failedCount = 0;
      for (const docSnap of sessionsSnap.docs) {
        const sessionId = docSnap.id;
        const session = docSnap.data();
        if (session.transcriptStatus === "complete") {
          if (session.transcript) mergedParts.push(session.transcript);
          continue;
        }
        try {
          const result = await transcribePacketSegmentInternal({
            packetRef,
            packet,
            sessionId,
            apiKey: OPENAI_API_KEY.value(),
          });
          if (result.transcript) mergedParts.push(result.transcript);
        } catch (error) {
          failedCount += 1;
          await packetRef.collection("sessions").doc(sessionId).set({
            transcriptStatus: "failed",
            transcriptError: String(error?.message || "Transcription failed."),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }
      }

      const transcriptFull = mergedParts.join(" ").trim().slice(0, MAX_TRANSCRIPT_CHARS);
      const transcriptStatus = failedCount > 0 ?
        (mergedParts.length ? "partial" : "failed") :
        "complete";
      await packetRef.set({
        [FIELDS.packets.transcriptFull]: transcriptFull,
        [FIELDS.packets.transcript]: transcriptFull,
        [FIELDS.packets.transcriptStatus]: transcriptStatus,
        [FIELDS.packets.transcriptError]: failedCount > 0 ? "One or more segments failed." : "",
        [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      return {transcriptFull, transcriptStatus};
    },
);

exports.transcribeTestAudio = onCall(
    {secrets: [OPENAI_API_KEY]},
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

exports.setActiveEvent = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const targetEventId = String(data.eventId || "").trim();
  const db = admin.firestore();

  if (targetEventId) {
    const targetRef = db.collection(COLLECTIONS.events).doc(targetEventId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Event not found.");
    }
  }

  const eventsSnap = await db.collection(COLLECTIONS.events).get();
  const batch = db.batch();
  eventsSnap.forEach((eventDoc) => {
    batch.update(eventDoc.ref, {
      [FIELDS.events.isActive]: Boolean(targetEventId) && eventDoc.id === targetEventId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return {ok: true, activeEventId: targetEventId || null};
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

exports.renameEnsemble = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const schoolId = String(data.schoolId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const name = String(data.name || "").trim();
  if (!schoolId || !ensembleId || !name) {
    throw new HttpsError("invalid-argument", "schoolId, ensembleId, and name required.");
  }

  const db = admin.firestore();
  const userSnap = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  const userRole = userSnap.exists ? userSnap.data().role : null;
  const userSchoolId = userSnap.exists ? userSnap.data().schoolId : null;
  const isAdmin = userRole === "admin";
  const isDirector = userRole === "director";
  if (!isAdmin && !(isDirector && userSchoolId === schoolId)) {
    throw new HttpsError("permission-denied", "Not authorized to rename ensemble.");
  }

  const ensembleRef = db
      .collection(COLLECTIONS.schools)
      .doc(schoolId)
      .collection(COLLECTIONS.ensembles)
      .doc(ensembleId);
  const ensembleSnap = await ensembleRef.get();
  if (!ensembleSnap.exists) {
    throw new HttpsError("not-found", "Ensemble not found.");
  }

  await ensembleRef.set({
    name,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  const packetsSnap = await db
      .collection(COLLECTIONS.packets)
      .where(FIELDS.packets.schoolId, "==", schoolId)
      .where(FIELDS.packets.ensembleId, "==", ensembleId)
      .get();

  const unreleasedStatuses = new Set(["draft", "reopened", "submitted", "locked"]);
  let updatedPacketCount = 0;
  const batch = db.batch();
  packetsSnap.docs.forEach((packetDoc) => {
    const packet = packetDoc.data() || {};
    const status = String(packet.status || "draft");
    if (!unreleasedStatuses.has(status)) return;
    const nextEnsembleSnapshot = packet.ensembleSnapshot &&
      typeof packet.ensembleSnapshot === "object" ?
      {...packet.ensembleSnapshot, ensembleName: name} :
      {
        schoolId,
        schoolName: packet.schoolName || "",
        ensembleId,
        ensembleName: name,
      };
    batch.set(packetDoc.ref, {
      [FIELDS.packets.ensembleName]: name,
      [FIELDS.packets.ensembleSnapshot]: nextEnsembleSnapshot,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    updatedPacketCount += 1;
  });
  if (updatedPacketCount > 0) {
    await batch.commit();
  }

  return {ok: true, ensembleId, name, updatedPacketCount};
});

exports.deleteSchool = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const schoolId = String(data.schoolId || "").trim();
  if (!schoolId) {
    throw new HttpsError("invalid-argument", "schoolId is required.");
  }

  const db = admin.firestore();
  const schoolRef = db.collection(COLLECTIONS.schools).doc(schoolId);
  const schoolSnap = await schoolRef.get();
  if (!schoolSnap.exists) {
    throw new HttpsError("not-found", "School not found.");
  }

  const ensemblesSnap = await schoolRef.collection(COLLECTIONS.ensembles).limit(1).get();
  if (!ensemblesSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Delete all ensembles in this school before deleting the school.",
    );
  }

  const directorsSnap = await db
      .collection(COLLECTIONS.users)
      .where(FIELDS.users.schoolId, "==", schoolId)
      .limit(1)
      .get();
  if (!directorsSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "One or more users are still attached to this school.",
    );
  }

  const eventsSnap = await db.collection(COLLECTIONS.events).get();
  for (const eventDoc of eventsSnap.docs) {
    const scheduleSnap = await db
        .collection(COLLECTIONS.events)
        .doc(eventDoc.id)
        .collection(COLLECTIONS.schedule)
        .where(FIELDS.schedule.schoolId, "==", schoolId)
        .limit(1)
        .get();
    if (!scheduleSnap.empty) {
      throw new HttpsError(
          "failed-precondition",
          "Event schedule entries exist for this school.",
      );
    }

    const entriesSnap = await db
        .collection(COLLECTIONS.events)
        .doc(eventDoc.id)
        .collection(COLLECTIONS.entries)
        .where(FIELDS.entries.schoolId, "==", schoolId)
        .limit(1)
        .get();
    if (!entriesSnap.empty) {
      throw new HttpsError(
          "failed-precondition",
          "Event entries exist for this school.",
      );
    }
  }

  const openPacketsSnap = await db
      .collection(COLLECTIONS.packets)
      .where(FIELDS.packets.schoolId, "==", schoolId)
      .limit(1)
      .get();
  if (!openPacketsSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Open packets are linked to this school.",
    );
  }

  await schoolRef.delete();
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
