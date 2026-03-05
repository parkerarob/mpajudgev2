const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");
const {PDFDocument, StandardFonts, rgb} = require("pdf-lib");
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
const DIRECTOR_PACKET_EXPORT_TTL_MS = 1000 * 60 * 30;
const DIRECTOR_PACKET_EXPORT_VERSION = "generated-v1";
const DIRECTOR_PACKET_EXPORT_RETENTION_MS = 1000 * 60 * 60 * 24 * 14;
const DIRECTOR_PACKET_EXPORT_STALE_FAILURE_MS = 1000 * 60 * 60 * 24 * 2;
const ORPHAN_PACKET_SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 2;
const GRADE_VALUES = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  F: 5,
};

// Temporary reliability mode for event operations:
// reCAPTCHA v3 App Check token exchange can fail/throttle in some browsers.
// Keep strict App Check on OpenAI-cost endpoints, but relax it for core packet workflow.
const APPCHECK_SENSITIVE_OPTIONS = {enforceAppCheck: false};
const APPCHECK_SENSITIVE_SECRET_OPTIONS = {
  // Temporary reliability mode for event operations (same rationale as above).
  // Keep secret handling, but do not hard-require App Check while token exchange is failing.
  enforceAppCheck: false,
  secrets: [OPENAI_API_KEY],
};

function buildDirectorPacketExportId(eventId, ensembleId) {
  return `${eventId}_${ensembleId}`;
}

function createSilentWavBuffer({
  durationSec = 1,
  sampleRate = 8000,
  channels = 1,
} = {}) {
  const frameCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const bytesPerSample = 2;
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function formLabelByJudgePosition(position) {
  return position === JUDGE_POSITIONS.sight ? "Sight Reading Form" : "Stage Form";
}

function judgeLabelByPosition(position) {
  if (position === JUDGE_POSITIONS.stage1) return "Stage 1 Judge";
  if (position === JUDGE_POSITIONS.stage2) return "Stage 2 Judge";
  if (position === JUDGE_POSITIONS.stage3) return "Stage 3 Judge";
  if (position === JUDGE_POSITIONS.sight) return "Sight Judge";
  return String(position || "Judge");
}

function drawWrappedText({
  page,
  font,
  text = "",
  x,
  y,
  maxWidth,
  size = 9,
  lineHeight = 10,
  color = rgb(0.08, 0.08, 0.08),
  maxLines = 1,
} = {}) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return y;
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateWidth = font.widthOfTextAtSize(candidate, size);
    if (candidateWidth <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  lines.slice(0, maxLines).forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - (index * lineHeight),
      size,
      font,
      color,
    });
  });
  return y - (Math.min(lines.length, maxLines) * lineHeight);
}

function drawSimpleValue({page, font, value, x, y, size = 9, color = rgb(0.08, 0.08, 0.08)} = {}) {
  const text = String(value || "").trim();
  if (!text) return;
  page.drawText(text, {x, y, size, font, color});
}

function renderStageTemplatePage({
  page,
  font,
  eventId,
  ensembleId,
  schoolId,
  grade,
  position,
  submission,
} = {}) {
  const dark = rgb(0.07, 0.07, 0.07);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 40;
  let y = pageHeight - margin;
  const captions = submission?.captions && typeof submission.captions === "object" ?
    submission.captions :
    {};
  const judgeName = String(submission?.judgeName || submission?.judgeEmail || "Unknown Judge");
  const judgeSlot = judgeLabelByPosition(position);
  const ensembleLabel = String(ensembleId || "");
  const schoolLabel = String(schoolId || "");
  const heading = "NCBA Music Performance Adjudication - Stage Form";
  drawSimpleValue({page, font, value: heading, x: margin, y, size: 16, color: dark});
  y -= 24;
  drawSimpleValue({
    page,
    font,
    value: `Event: ${eventId}   School: ${schoolLabel}   Ensemble: ${ensembleLabel}`,
    x: margin,
    y,
    size: 10,
    color: dark,
  });
  y -= 16;
  drawSimpleValue({
    page,
    font,
    value: `Judge: ${judgeName} (${judgeSlot})   Grade: ${grade || "N/A"}   Rating: ${String(submission?.computedFinalRatingLabel || "N/A")}`,
    x: margin,
    y,
    size: 10,
    color: dark,
  });
  y -= 18;
  drawSimpleValue({
    page,
    font,
    value: `Caption Total: ${Number(submission?.captionScoreTotal || 0)}   Status: Released`,
    x: margin,
    y,
    size: 10,
    color: dark,
  });
  y -= 22;

  const rows = CAPTION_TEMPLATES.stage || [];
  rows.forEach((row) => {
    const value = captions[row.key] || {};
    const gradeText = `${value.gradeLetter || ""}${value.gradeModifier || ""}`.trim() || "N/A";
    drawSimpleValue({
      page,
      font,
      value: `${row.label}: ${gradeText}`,
      x: margin,
      y,
      size: 10.5,
      color: dark,
    });
    y -= 13;
    y = drawWrappedText({
      page,
      font,
      text: String(value.comment || "").trim() || "No comment provided.",
      x: margin + 8,
      y,
      maxWidth: pageWidth - (margin * 2) - 8,
      size: 9,
      lineHeight: 11,
      color: dark,
      maxLines: 3,
    });
    y -= 8;
    if (y < 90) return;
  });
  drawSimpleValue({page, font, value: "Adjudicator Signature:", x: margin, y: 48, size: 10, color: dark});
  drawSimpleValue({page, font, value: judgeName, x: margin + 120, y: 48, size: 10, color: dark});
}

function renderSightTemplatePage({
  page,
  font,
  eventId,
  ensembleId,
  schoolId,
  grade,
  position,
  submission,
} = {}) {
  const dark = rgb(0.07, 0.07, 0.07);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 40;
  let y = pageHeight - margin;
  const captions = submission?.captions && typeof submission.captions === "object" ?
    submission.captions :
    {};
  const judgeName = String(submission?.judgeName || submission?.judgeEmail || "Unknown Judge");
  drawSimpleValue({page, font, value: "NCBA Music Performance Adjudication - Sight Reading Form", x: margin, y, size: 16, color: dark});
  y -= 24;
  drawSimpleValue({page, font, value: `Event: ${eventId}   School: ${schoolId}   Ensemble: ${ensembleId}`, x: margin, y, size: 10, color: dark});
  y -= 16;
  drawSimpleValue({page, font, value: `Judge: ${judgeName}`, x: margin, y, size: 10, color: dark});
  y -= 16;
  drawSimpleValue({
    page,
    font,
    value: `Slot: ${judgeLabelByPosition(position)}  Grade: ${grade || "N/A"}`,
    x: margin,
    y,
    size: 10,
    color: dark,
  });
  y -= 22;

  const captionOrder = [
    "toneQuality",
    "intonation",
    "balance",
    "technique",
    "rhythm",
    "musicianship",
    "prepTime",
  ];
  captionOrder.forEach((key) => {
    const value = captions[key] || {};
    const label = key;
    const gradeText = `${value.gradeLetter || ""}${value.gradeModifier || ""}`.trim() || "N/A";
    const header = `${label}: ${gradeText}`;
    drawSimpleValue({page, font, value: header, x: margin, y, size: 10.5, color: dark});
    y -= 16;
    y = drawWrappedText({
      page,
      font,
      text: String(value.comment || "").trim(),
      x: margin + 8,
      y,
      maxWidth: pageWidth - (margin * 2) - 8,
      size: 9,
      lineHeight: 11,
      color: dark,
      maxLines: 3,
    });
    y -= 8;
  });

  drawSimpleValue({
    page,
    font,
    value: `Caption Total: ${Number(submission?.captionScoreTotal || 0)}  Final Rating: ${String(submission?.computedFinalRatingLabel || "N/A")}`,
    x: margin,
    y: 52,
    size: 10,
    color: dark,
  });
}

async function renderSubmissionTemplatePdf({
  eventId,
  ensembleId,
  schoolId,
  grade,
  position,
  submission,
} = {}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  if (position === JUDGE_POSITIONS.sight) {
    renderSightTemplatePage({
      page,
      font,
      eventId,
      ensembleId,
      schoolId,
      grade,
      position,
      submission,
    });
  } else {
    renderStageTemplatePage({
      page,
      font,
      eventId,
      ensembleId,
      schoolId,
      grade,
      position,
      submission,
    });
  }
  return await pdfDoc.save();
}

async function generateDirectorPacketExportInternal({
  eventId,
  ensembleId,
  grade,
  actorUid = "",
} = {}) {
  if (!eventId || !ensembleId || !grade) {
    throw new Error("eventId, ensembleId, and grade are required for export.");
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const positions = requiredPositionsForGrade(grade);
  const submissionDocs = await Promise.all(
      positions.map((position) => db.collection(COLLECTIONS.submissions).doc(`${eventId}_${ensembleId}_${position}`).get()),
  );
  const submissionsByPosition = {};
  submissionDocs.forEach((docSnap, index) => {
    const position = positions[index];
    submissionsByPosition[position] = docSnap.exists ? docSnap.data() : null;
  });

  const schoolId = String(submissionsByPosition[positions[0]]?.schoolId || "");

  const exportId = buildDirectorPacketExportId(eventId, ensembleId);
  const judgeAssets = {};
  const packetPdfBytes = [];
  for (const position of positions) {
    const submission = submissionsByPosition[position];
    if (!submission) continue;
    const judgePdfBytes = await renderSubmissionTemplatePdf({
      eventId,
      ensembleId,
      schoolId,
      grade,
      position,
      submission,
    });
    const judgePdfPath = `exports/${eventId}/${ensembleId}/${position}.pdf`;
    await bucket.file(judgePdfPath).save(Buffer.from(judgePdfBytes), {
      resumable: false,
      contentType: "application/pdf",
      metadata: {
        metadata: {
          eventId,
          ensembleId,
          judgePosition: position,
          exportType: "director-judge-form",
          templateVersion: DIRECTOR_PACKET_EXPORT_VERSION,
        },
      },
    });
    packetPdfBytes.push(judgePdfBytes);
    judgeAssets[position] = {
      judgePosition: position,
      judgeLabel: judgeLabelByPosition(position),
      formType: position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage,
      formLabel: formLabelByJudgePosition(position),
      judgeName: submission.judgeName || "",
      judgeEmail: submission.judgeEmail || "",
      pdfPath: judgePdfPath,
      audioUrl: String(submission.audioUrl || ""),
      audioPath: String(
          submission.audioPath ||
          getStoragePathFromUrl(submission.audioUrl) ||
          "",
      ),
    };
  }

  const combinedDoc = await PDFDocument.create();
  for (const bytes of packetPdfBytes) {
    const single = await PDFDocument.load(bytes);
    const copied = await combinedDoc.copyPages(single, single.getPageIndices());
    copied.forEach((page) => combinedDoc.addPage(page));
  }
  const combinedPdfBytes = await combinedDoc.save();
  const combinedPdfPath = `exports/${eventId}/${ensembleId}/packet_combined.pdf`;
  await bucket.file(combinedPdfPath).save(Buffer.from(combinedPdfBytes), {
    resumable: false,
    contentType: "application/pdf",
    metadata: {
      metadata: {
        eventId,
        ensembleId,
        exportType: "director-packet-combined",
        templateVersion: DIRECTOR_PACKET_EXPORT_VERSION,
      },
    },
  });

  const exportRef = db.collection(COLLECTIONS.packetExports).doc(exportId);
  await exportRef.set({
    eventId,
    ensembleId,
    schoolId,
    grade,
    status: "ready",
    templateVersion: DIRECTOR_PACKET_EXPORT_VERSION,
    judgeAssets,
    combinedPdfPath,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    generatedBy: actorUid || "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {
    exportId,
    combinedPdfPath,
    judgeAssets,
    templateVersion: DIRECTOR_PACKET_EXPORT_VERSION,
  };
}

async function markDirectorPacketExportFailure({
  eventId,
  ensembleId,
  schoolId = "",
  error = "",
  actorUid = "",
} = {}) {
  if (!eventId || !ensembleId) return;
  const exportRef = admin
      .firestore()
      .collection(COLLECTIONS.packetExports)
      .doc(buildDirectorPacketExportId(eventId, ensembleId));
  await exportRef.set({
    eventId,
    ensembleId,
    schoolId,
    status: "failed",
    error: String(error || "Export generation failed."),
    generatedBy: actorUid || "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

function buildMockCaptionsForForm(formType) {
  const template = CAPTION_TEMPLATES[formType] || CAPTION_TEMPLATES.stage || [];
  const letters = ["A", "A", "B", "A", "B", "A", "B"];
  const captions = {};
  template.forEach((item, index) => {
    captions[item.key] = {
      gradeLetter: letters[index % letters.length],
      gradeModifier: index % 3 === 0 ? "+" : "",
      comment: `${item.label}: strong fundamentals with clear ensemble response.`,
    };
  });
  return captions;
}

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
  const profile = userSnap.exists ? (userSnap.data() || {}) : null;
  if (!profile || !isAdminProfile(profile)) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return profile;
}

async function assertOpsLead(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const userSnap = await admin
      .firestore()
      .collection(COLLECTIONS.users)
      .doc(request.auth.uid)
      .get();
  const profile = userSnap.exists ? (userSnap.data() || {}) : null;
  if (!profile || !isOpsLeadProfile(profile)) {
    throw new HttpsError("permission-denied", "Operations lead access required.");
  }
  return profile;
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
  const profile = userSnap.exists ? (userSnap.data() || {}) : {};
  const role = getEffectiveRole(profile);
  if (!allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", "Not authorized.");
  }
  return profile;
}

function normalizeRoleValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "admin") return "admin";
  if (lower === "judge") return "judge";
  if (lower === "director") return "director";
  if (lower === "teamlead" || lower === "team_lead" || lower === "team lead") {
    return "teamLead";
  }
  return "";
}

function isAdminProfile(profile = {}) {
  return normalizeRoleValue(profile.role) === "admin" || profile.roles?.admin === true;
}

function isTeamLeadProfile(profile = {}) {
  return normalizeRoleValue(profile.role) === "teamLead" || profile.roles?.teamLead === true;
}

function isOpsLeadProfile(profile = {}) {
  return isAdminProfile(profile) || isTeamLeadProfile(profile);
}

function getEffectiveRole(profile = {}) {
  const normalizedRole = normalizeRoleValue(profile.role);
  if (normalizedRole) return normalizedRole;
  if (profile.roles?.admin === true) return "admin";
  if (profile.roles?.teamLead === true) return "teamLead";
  if (profile.roles?.director === true) return "director";
  if (profile.roles?.judge === true) return "judge";
  return null;
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
      .limit(1)
      .get();
  if (activeSnap.empty) return null;
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

function canonicalizeSchoolText(value) {
  return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
}

function schoolPrefixVariants(schoolName) {
  const base = canonicalizeSchoolText(schoolName);
  if (!base) return [];
  const variants = new Set([base]);

  const withoutSchool = base.replace(/\bschool\b/g, "").replace(/\s+/g, " ").trim();
  if (withoutSchool) variants.add(withoutSchool);

  const shortForms = [
    [/\bhigh school\b/g, "hs"],
    [/\bmiddle school\b/g, "ms"],
    [/\belementary school\b/g, "es"],
  ];
  shortForms.forEach(([pattern, replacement]) => {
    const next = base.replace(pattern, replacement).replace(/\s+/g, " ").trim();
    if (next) variants.add(next);
  });

  const descriptorTokens = new Set(["school", "high", "middle", "elementary", "hs", "ms", "es"]);
  const seedVariants = Array.from(variants);
  seedVariants.forEach((seed) => {
    const tokens = seed.split(" ").filter(Boolean);
    while (tokens.length > 1 && descriptorTokens.has(tokens[tokens.length - 1])) {
      tokens.pop();
      const next = tokens.join(" ").trim();
      if (next) variants.add(next);
    }
  });

  return [...variants]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
}

function normalizeEnsembleNameForSchool({schoolName, ensembleName}) {
  const finalizeName = (value) => {
    const text = String(value || "").trim();
    const canonical = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    return canonical === "band" ? "Concert Band" : text;
  };
  const original = String(ensembleName || "").trim();
  if (!original) return "";
  const variants = schoolPrefixVariants(schoolName);
  if (!variants.length) return finalizeName(original);

  const compactName = original.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const matched = variants.find((variant) =>
    compactName === variant || compactName.startsWith(`${variant} `));
  if (!matched) return finalizeName(original);

  const tokens = matched.split(" ").filter(Boolean);
  const sourceTokens = original.split(/\s+/);
  let sourceIdx = 0;
  let matchIdx = 0;
  while (sourceIdx < sourceTokens.length && matchIdx < tokens.length) {
    const token = sourceTokens[sourceIdx];
    const canonical = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = tokens[matchIdx].replace(/[^a-z0-9]/g, "");
    if (!canonical) {
      sourceIdx += 1;
      continue;
    }
    if (canonical === target) {
      sourceIdx += 1;
      matchIdx += 1;
      continue;
    }
    return finalizeName(original);
  }
  if (matchIdx !== tokens.length) return finalizeName(original);

  const remainder = sourceTokens.slice(sourceIdx).join(" ")
      .replace(/^[\s\-:|/]+/, "")
      .trim();
  return finalizeName(remainder || original);
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
    APPCHECK_SENSITIVE_SECRET_OPTIONS,
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
    APPCHECK_SENSITIVE_SECRET_OPTIONS,
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
      const isAdmin = isAdminProfile(userSnap.data() || {});
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

exports.createOpenPacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertRole(request, ["judge", "admin"]);
  const data = request.data || {};
  const schoolId = String(data.schoolId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  if (!schoolId || !ensembleId) {
    throw new HttpsError("invalid-argument", "Select an existing school and ensemble.");
  }
  const schoolName = String(data.schoolName || "").trim();
  const ensembleName = normalizeEnsembleNameForSchool({
    schoolName,
    ensembleName: String(data.ensembleName || "").trim(),
  });
  const formType = data.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
  const useActiveEventDefaults = data.useActiveEventDefaults !== false;
  const assignment = useActiveEventDefaults ?
    await resolveActiveEventAssignmentForUser(request.auth.uid) :
    null;
  const incomingSnapshot =
    data.ensembleSnapshot && typeof data.ensembleSnapshot === "object" ?
      data.ensembleSnapshot :
      null;
  const ensembleSnapshot = incomingSnapshot ?
    {
      ...incomingSnapshot,
      schoolName: schoolName || incomingSnapshot.schoolName || "",
      ensembleName,
    } :
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
    [FIELDS.packets.schoolId]: schoolId,
    [FIELDS.packets.ensembleId]: ensembleId,
    [FIELDS.packets.ensembleSnapshot]: ensembleSnapshot,
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

exports.submitOpenPacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertRole(request, ["judge", "admin"]);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) {
    throw new HttpsError("invalid-argument", "packetId required.");
  }
  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  const userSnap = await admin
      .firestore()
      .collection(COLLECTIONS.users)
      .doc(request.auth.uid)
      .get();
  const userRole = userSnap.exists ? userSnap.data().role : null;
  const isAdmin = isAdminProfile(userSnap.data() || {});
  const useActiveEventDefaults = data.useActiveEventDefaults !== false;
  const assignment = useActiveEventDefaults ?
    await resolveActiveEventAssignmentForUser(request.auth.uid) :
    null;
  const nextStatus = "locked";
  const captions = data.captions || {};
  const captionScoreTotal = calculateCaptionTotal(captions);
  const rating = computeFinalRatingFromTotal(captionScoreTotal);
  let currentStatus = "draft";
  await db.runTransaction(async (tx) => {
    const packetSnap = await tx.get(packetRef);
    if (!packetSnap.exists) {
      throw new HttpsError("not-found", "Packet not found.");
    }
    const packet = packetSnap.data() || {};
    const isOwner = packet.createdByJudgeUid === request.auth.uid;
    if (!isAdmin && !isOwner) {
      throw new HttpsError("permission-denied", "Not authorized.");
    }
    if (!isAdmin && packet.locked === true) {
      throw new HttpsError("failed-precondition", "Packet is locked.");
    }
    currentStatus = packet.status || "draft";
    if (!["draft", "reopened"].includes(currentStatus)) {
      throw new HttpsError("failed-precondition", "Packet cannot be submitted.");
    }
    const nextSchoolName = String(data.schoolName || packet.schoolName || "");
    const nextEnsembleName = normalizeEnsembleNameForSchool({
      schoolName: nextSchoolName,
      ensembleName: String(data.ensembleName || packet.ensembleName || ""),
    });
    const nextSchoolId = String(data.schoolId || packet.schoolId || "");
    const nextEnsembleId = String(data.ensembleId || packet.ensembleId || "");
    if (!nextSchoolId || !nextEnsembleId) {
      throw new HttpsError(
          "failed-precondition",
          "Packet must be linked to an existing school and ensemble before submit.",
      );
    }
    const incomingSnapshot =
      data.ensembleSnapshot && typeof data.ensembleSnapshot === "object" ?
        data.ensembleSnapshot :
        null;
    const baseSnapshot = incomingSnapshot || packet.ensembleSnapshot || null;
    const nextEnsembleSnapshot =
      baseSnapshot && typeof baseSnapshot === "object" ?
        {
          ...baseSnapshot,
          schoolName: nextSchoolName || baseSnapshot.schoolName || "",
          ensembleName: nextEnsembleName,
        } :
        null;
    const nextFormType =
      (data.formType === FORM_TYPES.sight || data.formType === FORM_TYPES.stage) ?
        data.formType :
        (packet.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage);
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
    tx.set(packetRef, payload, {merge: true});
  });
  await writePacketAudit(packetRef, {
    action: "submit",
    fromStatus: currentStatus,
    toStatus: nextStatus,
    actor: {uid: request.auth.uid, role: userRole || "judge"},
  });
  return {packetId, status: nextStatus, autoReleased: false};
});

exports.lockPacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  let priorStatus = null;
  await db.runTransaction(async (tx) => {
    const packetSnap = await tx.get(packetRef);
    if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
    const packet = packetSnap.data() || {};
    priorStatus = packet.status || null;
    tx.set(packetRef, {
      [FIELDS.packets.locked]: true,
      [FIELDS.packets.status]: "locked",
      [FIELDS.packets.releasedAt]: null,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  await writePacketAudit(packetRef, {
    action: "lock",
    fromStatus: priorStatus,
    toStatus: "locked",
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: "locked"};
});

exports.unlockPacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  let priorStatus = null;
  await db.runTransaction(async (tx) => {
    const packetSnap = await tx.get(packetRef);
    if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
    const packet = packetSnap.data() || {};
    priorStatus = packet.status || null;
    if (packet.locked !== true) {
      throw new HttpsError("failed-precondition", "Packet is not locked.");
    }
    tx.set(packetRef, {
      [FIELDS.packets.locked]: false,
      [FIELDS.packets.status]: "reopened",
      [FIELDS.packets.releasedAt]: null,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  await writePacketAudit(packetRef, {
    action: "unlock",
    fromStatus: priorStatus,
    toStatus: "reopened",
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: "reopened"};
});

exports.releaseOpenPacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  let priorStatus = null;
  await db.runTransaction(async (tx) => {
    const packetSnap = await tx.get(packetRef);
    if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
    const packet = packetSnap.data() || {};
    priorStatus = packet.status || null;
    if (packet.locked !== true) {
      throw new HttpsError("failed-precondition", "Open packet must be locked before release.");
    }
    if (packet.status !== "locked") {
      throw new HttpsError("failed-precondition", "Only locked packets can be released.");
    }
    tx.set(packetRef, {
      [FIELDS.packets.status]: "released",
      [FIELDS.packets.releasedAt]: admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  await writePacketAudit(packetRef, {
    action: "release",
    fromStatus: priorStatus,
    toStatus: "released",
    actor: {uid: request.auth.uid, role: "admin"},
  });
  return {packetId, status: "released"};
});

exports.unreleaseOpenPacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const packetId = data.packetId;
  if (!packetId) throw new HttpsError("invalid-argument", "packetId required.");
  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  let priorStatus = null;
  let nextStatus = "reopened";
  await db.runTransaction(async (tx) => {
    const packetSnap = await tx.get(packetRef);
    if (!packetSnap.exists) throw new HttpsError("not-found", "Packet not found.");
    const packet = packetSnap.data() || {};
    priorStatus = packet.status || null;
    if (packet.status !== "released") {
      throw new HttpsError("failed-precondition", "Only released packets can be unreleased.");
    }
    nextStatus = packet.locked === true ? "locked" : "reopened";
    tx.set(packetRef, {
      [FIELDS.packets.status]: nextStatus,
      [FIELDS.packets.releasedAt]: null,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  await writePacketAudit(packetRef, {
    action: "unrelease",
    fromStatus: priorStatus,
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
  const isAdmin = isAdminProfile(userSnap.data() || {});
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
    APPCHECK_SENSITIVE_SECRET_OPTIONS,
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
      const isAdmin = isAdminProfile(userSnap.data() || {});
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
    APPCHECK_SENSITIVE_SECRET_OPTIONS,
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
      const isAdmin = isAdminProfile(userSnap.data() || {});
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
    APPCHECK_SENSITIVE_SECRET_OPTIONS,
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
      const isAdmin = isAdminProfile(userSnap.data() || {});
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
    APPCHECK_SENSITIVE_SECRET_OPTIONS,
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

exports.releasePacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
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
  const submissionRefs = positions.map((position) => {
    const submissionId = `${eventId}_${ensembleId}_${position}`;
    return db.collection(COLLECTIONS.submissions).doc(submissionId);
  });
  let schoolId = "";
  await db.runTransaction(async (tx) => {
    const submissionDocs = await Promise.all(submissionRefs.map((ref) => tx.get(ref)));
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
    schoolId = String(submissions[0]?.schoolId || "");
    submissionRefs.forEach((ref) => {
      tx.update(ref, {
        [FIELDS.submissions.status]: STATUSES.released,
        releasedAt: admin.firestore.FieldValue.serverTimestamp(),
        releasedBy: request.auth.uid,
      });
    });
  });
  try {
    await generateDirectorPacketExportInternal({
      eventId,
      ensembleId,
      grade,
      actorUid: request.auth.uid,
    });
  } catch (error) {
    logger.error("generateDirectorPacketExportInternal failed during releasePacket", {
      eventId,
      ensembleId,
      error: error?.message || String(error),
    });
    await markDirectorPacketExportFailure({
      eventId,
      ensembleId,
      schoolId,
      error: error?.message || String(error),
      actorUid: request.auth.uid,
    });
  }
  return {released: true, grade};
});

exports.unreleasePacket = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
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
  const submissionRefs = positions.map((position) => {
    const submissionId = `${eventId}_${ensembleId}_${position}`;
    return db.collection(COLLECTIONS.submissions).doc(submissionId);
  });
  await db.runTransaction(async (tx) => {
    const submissionDocs = await Promise.all(submissionRefs.map((ref) => tx.get(ref)));
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
    submissionRefs.forEach((ref) => {
      tx.update(ref, {
        [FIELDS.submissions.status]: STATUSES.submitted,
        releasedAt: admin.firestore.FieldValue.delete(),
        releasedBy: admin.firestore.FieldValue.delete(),
      });
    });
  });
  const batch = db.batch();
  const exportRef = db
      .collection(COLLECTIONS.packetExports)
      .doc(buildDirectorPacketExportId(eventId, ensembleId));
  batch.set(exportRef, {
    status: "revoked",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await batch.commit();
  return {released: false, grade};
});

exports.regenerateDirectorPacketExport = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  if (!eventId || !ensembleId) {
    throw new HttpsError("invalid-argument", "eventId and ensembleId required.");
  }
  const grade = await resolvePerformanceGrade(eventId, ensembleId);
  if (!grade) {
    throw new HttpsError("failed-precondition", "Performance grade required.");
  }
  try {
    const result = await generateDirectorPacketExportInternal({
      eventId,
      ensembleId,
      grade,
      actorUid: request.auth.uid,
    });
    return {ok: true, ...result};
  } catch (error) {
    await markDirectorPacketExportFailure({
      eventId,
      ensembleId,
      error: error?.message || String(error),
      actorUid: request.auth.uid,
    });
    throw new HttpsError("internal", error?.message || "Unable to regenerate packet export.");
  }
});

exports.getDirectorPacketAssets = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  if (!eventId || !ensembleId) {
    throw new HttpsError("invalid-argument", "eventId and ensembleId required.");
  }
  const db = admin.firestore();
  const userSnap = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  const user = userSnap.exists ? (userSnap.data() || {}) : {};
  const role = String(user.role || "");
  const isAdmin = isAdminProfile(user);
  const exportRef = db
      .collection(COLLECTIONS.packetExports)
      .doc(buildDirectorPacketExportId(eventId, ensembleId));
  const exportSnap = await exportRef.get();
  if (!exportSnap.exists) {
    throw new HttpsError("not-found", "Packet assets not found.");
  }
  const exportData = exportSnap.data() || {};
  const schoolId = String(exportData.schoolId || "");
  if (!isAdmin) {
    if (role !== "director") {
      throw new HttpsError("permission-denied", "Not authorized.");
    }
    if (!schoolId || String(user.schoolId || "") !== schoolId) {
      throw new HttpsError("permission-denied", "Not authorized for this school.");
    }
  }
  if (String(exportData.status || "") !== "ready") {
    return {
      status: exportData.status || "pending",
      templateVersion: exportData.templateVersion || "",
      generatedAt: exportData.generatedAt || null,
      error: exportData.error || "",
      combined: null,
      judges: {},
    };
  }
  const bucket = admin.storage().bucket();
  const expires = Date.now() + DIRECTOR_PACKET_EXPORT_TTL_MS;
  const signed = async (path) => {
    const value = String(path || "").trim();
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
    try {
      const file = bucket.file(value);
      const [exists] = await file.exists();
      if (!exists) return "";
      try {
        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires,
        });
        if (url) return url;
      } catch (signedErr) {
        logger.warn("getDirectorPacketAssets signed URL unavailable; falling back to token URL", {
          path: value,
          error: signedErr?.message || String(signedErr),
        });
      }

      // Fallback to Firebase token URL if signed URLs are unavailable in this project IAM setup.
      const [metadata] = await file.getMetadata();
      const existingTokenRaw =
        metadata?.metadata?.firebaseStorageDownloadTokens ||
        metadata?.firebaseStorageDownloadTokens ||
        "";
      let token = String(existingTokenRaw || "")
          .split(",")
          .map((item) => item.trim())
          .find(Boolean);
      if (!token) {
        token = crypto.randomUUID();
        const nextMetadata = {
          ...(metadata?.metadata || {}),
          firebaseStorageDownloadTokens: token,
        };
        await file.setMetadata({metadata: nextMetadata});
      }
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(value)}?alt=media&token=${token}`;
    } catch (error) {
      logger.error("getDirectorPacketAssets signed URL failed", {
        path: value,
        error: error?.message || String(error),
      });
      return "";
    }
  };
  const judgeAssets = exportData.judgeAssets && typeof exportData.judgeAssets === "object" ?
    exportData.judgeAssets :
    {};
  const judgeKeys = Object.keys(judgeAssets);
  const signedJudges = {};
  for (const key of judgeKeys) {
    const item = judgeAssets[key] || {};
    signedJudges[key] = {
      ...item,
      pdfUrl: item.pdfPath ? await signed(item.pdfPath) : "",
      audioUrl: item.audioPath ? await signed(item.audioPath) : (item.audioUrl || ""),
    };
  }
  const combinedPath = String(exportData.combinedPdfPath || "");
  const combinedUrl = combinedPath ? await signed(combinedPath) : "";
  return {
    status: "ready",
    templateVersion: exportData.templateVersion || "",
    generatedAt: exportData.generatedAt || null,
    error: exportData.error || "",
    combined: combinedPath ? {path: combinedPath, url: combinedUrl} : null,
    judges: signedJudges,
  };
});

exports.releaseMockPacketForAshleyTesting = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const db = admin.firestore();
  const activeSnap = await db
      .collection(COLLECTIONS.events)
      .where(FIELDS.events.isActive, "==", true)
      .limit(1)
      .get();
  if (activeSnap.empty) {
    throw new HttpsError("failed-precondition", "No active event.");
  }
  const eventId = activeSnap.docs[0].id;
  const schoolIdInput = String(data.schoolId || "").trim();
  const ensembleIdInput = String(data.ensembleId || "").trim();
  const grade = normalizeGrade(String(data.grade || "IV")) || "IV";

  let schoolId = schoolIdInput;
  let schoolName = "";
  if (!schoolId) {
    const schoolsSnap = await db.collection(COLLECTIONS.schools).get();
    const match = schoolsSnap.docs.find((docSnap) => {
      const name = String(docSnap.data()?.name || "").toLowerCase();
      return name.includes("ashley") && name.includes("high");
    });
    if (!match) {
      throw new HttpsError("not-found", "Ashley High School was not found.");
    }
    schoolId = match.id;
    schoolName = String(match.data()?.name || "");
  } else {
    const schoolSnap = await db.collection(COLLECTIONS.schools).doc(schoolId).get();
    if (!schoolSnap.exists) {
      throw new HttpsError("not-found", "School not found.");
    }
    schoolName = String(schoolSnap.data()?.name || schoolId);
  }

  let ensembleId = ensembleIdInput;
  let ensembleName = "";
  if (!ensembleId) {
    const scheduleSnap = await db
        .collection(COLLECTIONS.events)
        .doc(eventId)
        .collection(COLLECTIONS.schedule)
        .where(FIELDS.schedule.schoolId, "==", schoolId)
        .get();
    if (!scheduleSnap.empty) {
      const preferred = scheduleSnap.docs.find((docSnap) => {
        const name = String(docSnap.data()?.ensembleName || "").toLowerCase();
        return name.includes("concert") && name.includes("band");
      }) || scheduleSnap.docs[0];
      ensembleId = String(preferred.data()?.ensembleId || preferred.id);
      ensembleName = String(preferred.data()?.ensembleName || ensembleId);
    }
  }
  if (!ensembleId) {
    const ensembleSnap = await db
        .collection(COLLECTIONS.schools)
        .doc(schoolId)
        .collection(COLLECTIONS.ensembles)
        .limit(1)
        .get();
    if (ensembleSnap.empty) {
      throw new HttpsError("not-found", "No ensemble found for school.");
    }
    ensembleId = ensembleSnap.docs[0].id;
    ensembleName = String(ensembleSnap.docs[0].data()?.name || ensembleId);
  }
  if (!ensembleName) {
    const scheduleDoc = await db
        .collection(COLLECTIONS.events)
        .doc(eventId)
        .collection(COLLECTIONS.schedule)
        .where(FIELDS.schedule.ensembleId, "==", ensembleId)
        .limit(1)
        .get();
    if (!scheduleDoc.empty) {
      ensembleName = String(scheduleDoc.docs[0].data()?.ensembleName || ensembleId);
    } else {
      const ensSnap = await db
          .collection(COLLECTIONS.schools)
          .doc(schoolId)
          .collection(COLLECTIONS.ensembles)
          .doc(ensembleId)
          .get();
      ensembleName = ensSnap.exists ? String(ensSnap.data()?.name || ensembleId) : ensembleId;
    }
  }

  await db
      .collection(COLLECTIONS.events)
      .doc(eventId)
      .collection(COLLECTIONS.entries)
      .doc(ensembleId)
      .set({
        eventId,
        schoolId,
        schoolName,
        ensembleId,
        ensembleName,
        [FIELDS.entries.performanceGrade]: grade,
        status: "ready",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

  const bucket = admin.storage().bucket();
  const positions = requiredPositionsForGrade(grade);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const writeOps = [];
  for (const position of positions) {
    const formType = position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
    const captions = buildMockCaptionsForForm(formType);
    const total = calculateCaptionTotal(captions);
    const rating = computeFinalRatingFromTotal(total);
    const audioPath = `audio/mock/${eventId}/${ensembleId}/${position}.wav`;
    const wav = createSilentWavBuffer({durationSec: 4});
    await bucket.file(audioPath).save(wav, {
      resumable: false,
      contentType: "audio/wav",
      metadata: {
        metadata: {
          eventId,
          ensembleId,
          judgePosition: position,
          source: "mock",
        },
      },
    });
    const submissionId = `${eventId}_${ensembleId}_${position}`;
    const ref = db.collection(COLLECTIONS.submissions).doc(submissionId);
    writeOps.push(ref.set({
      eventId,
      ensembleId,
      schoolId,
      judgePosition: position,
      formType,
      status: STATUSES.released,
      locked: true,
      audioUrl: "",
      audioPath,
      audioDurationSec: 4,
      transcript: `${judgeLabelByPosition(position)} mock transcript for Ashley High School testing.`,
      captions,
      captionScoreTotal: total,
      computedFinalRatingJudge: rating.value,
      computedFinalRatingLabel: rating.label,
      judgeName: `${judgeLabelByPosition(position)} Mock`,
      judgeEmail: `${position}.mock@mpajudge.local`,
      judgeTitle: "Mock Judge",
      judgeAffiliation: "Testing",
      submittedAt: now,
      releasedAt: now,
      releasedBy: request.auth.uid,
      updatedAt: now,
      createdAt: now,
    }, {merge: true}));
  }
  await Promise.all(writeOps);

  try {
    await generateDirectorPacketExportInternal({
      eventId,
      ensembleId,
      grade,
      actorUid: request.auth.uid,
    });
  } catch (error) {
    await markDirectorPacketExportFailure({
      eventId,
      ensembleId,
      schoolId,
      error: error?.message || String(error),
      actorUid: request.auth.uid,
    });
    throw new HttpsError("internal", `Mock submissions created, but export failed: ${error?.message || String(error)}`);
  }

  return {
    ok: true,
    eventId,
    schoolId,
    schoolName,
    ensembleId,
    ensembleName,
    grade,
    released: true,
  };
});

exports.unlockSubmission = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
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
  const db = admin.firestore();
  const submissionRef = db
      .collection(COLLECTIONS.submissions)
      .doc(submissionId);
  await db.runTransaction(async (tx) => {
    const submissionSnap = await tx.get(submissionRef);
    if (!submissionSnap.exists) {
      throw new HttpsError("not-found", "Submission not found.");
    }
    const submission = submissionSnap.data() || {};
    if (submission.status !== STATUSES.submitted) {
      throw new HttpsError(
          "failed-precondition",
          "Only submitted packets can be unlocked.",
      );
    }
    if (submission.locked !== true) {
      throw new HttpsError(
          "failed-precondition",
          "Submission is already unlocked.",
      );
    }
    tx.update(submissionRef, {
      [FIELDS.submissions.locked]: false,
      unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
      unlockedBy: request.auth.uid,
    });
  });
  return {locked: false};
});

exports.lockSubmission = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
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
  const db = admin.firestore();
  const submissionRef = db
      .collection(COLLECTIONS.submissions)
      .doc(submissionId);
  await db.runTransaction(async (tx) => {
    const submissionSnap = await tx.get(submissionRef);
    if (!submissionSnap.exists) {
      throw new HttpsError("not-found", "Submission not found.");
    }
    const submission = submissionSnap.data() || {};
    if (submission.status !== STATUSES.submitted && submission.status !== STATUSES.released) {
      throw new HttpsError(
          "failed-precondition",
          "Only submitted or released submissions can be locked.",
      );
    }
    if (submission.locked === true) {
      throw new HttpsError(
          "failed-precondition",
          "Submission is already locked.",
      );
    }
    tx.update(submissionRef, {
      [FIELDS.submissions.locked]: true,
    });
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
  if (!["admin", "teamLead", "judge", "director"].includes(role)) {
    throw new HttpsError(
        "invalid-argument",
        "Role must be admin, teamLead, judge, or director.",
    );
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
  if (existingSnap.exists && isAdminProfile(existingSnap.data() || {})) {
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
          teamLead: role === "teamLead",
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

exports.assignDirectorSchool = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const directorUid = String(data.directorUid || "").trim();
  const schoolId = String(data.schoolId || "").trim();
  if (!directorUid || !schoolId) {
    throw new HttpsError("invalid-argument", "directorUid and schoolId are required.");
  }
  const db = admin.firestore();
  const [directorSnap, schoolSnap] = await Promise.all([
    db.collection(COLLECTIONS.users).doc(directorUid).get(),
    db.collection(COLLECTIONS.schools).doc(schoolId).get(),
  ]);
  if (!directorSnap.exists) {
    throw new HttpsError("not-found", "Director user not found.");
  }
  if (!schoolSnap.exists) {
    throw new HttpsError("not-found", "School not found.");
  }
  const directorData = directorSnap.data() || {};
  const isDirectorCapable = String(directorData.role || "") === "director" ||
    String(directorData.role || "") === "admin" ||
    directorData?.roles?.director === true;
  if (!isDirectorCapable) {
    throw new HttpsError("failed-precondition", "Target user is not director-capable.");
  }
  const existingRoles = directorData.roles && typeof directorData.roles === "object" ?
    directorData.roles :
    {};
  await directorSnap.ref.set({
    [FIELDS.users.schoolId]: schoolId,
    [FIELDS.users.roles]: {
      ...existingRoles,
      director: true,
      admin: directorData.role === "admin" || existingRoles.admin === true,
      judge: existingRoles.judge === true,
      teamLead: existingRoles.teamLead === true,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, directorUid, schoolId};
});

exports.unassignDirectorSchool = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const directorUid = String(data.directorUid || "").trim();
  if (!directorUid) {
    throw new HttpsError("invalid-argument", "directorUid is required.");
  }
  const db = admin.firestore();
  const directorRef = db.collection(COLLECTIONS.users).doc(directorUid);
  const directorSnap = await directorRef.get();
  if (!directorSnap.exists) {
    throw new HttpsError("not-found", "Director user not found.");
  }
  const directorData = directorSnap.data() || {};
  const isDirector = String(directorData.role || "") === "director" ||
    directorData?.roles?.director === true;
  if (!isDirector) {
    throw new HttpsError("failed-precondition", "Target user is not a director.");
  }
  await directorRef.set({
    [FIELDS.users.schoolId]: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, directorUid};
});

exports.deleteEnsemble = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const schoolId = String(data.schoolId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const forceDelete = data.force === true;
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
  const isAdmin = isAdminProfile(userSnap.data() || {});
  const isDirector = userRole === "director";
  if (!isAdmin && !(isDirector && userSchoolId === schoolId)) {
    throw new HttpsError("permission-denied", "Not authorized to delete.");
  }
  if (forceDelete && !isAdmin) {
    throw new HttpsError("permission-denied", "Admin required for force delete.");
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

  const deleteDocsInBatches = async (docs) => {
    if (!docs || !docs.length) return 0;
    let totalDeleted = 0;
    for (let idx = 0; idx < docs.length; idx += 400) {
      const chunk = docs.slice(idx, idx + 400);
      const batch = db.batch();
      chunk.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      totalDeleted += chunk.length;
    }
    return totalDeleted;
  };

  const eventsSnap = await db.collection(COLLECTIONS.events).get();
  if (!forceDelete) {
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
    return {deleted: true, forced: false};
  }

  let deletedEntries = 0;
  let deletedSchedule = 0;
  let deletedSubmissions = 0;
  let deletedPacketExports = 0;
  let deletedPackets = 0;

  for (const eventDoc of eventsSnap.docs) {
    const eventRef = db.collection(COLLECTIONS.events).doc(eventDoc.id);
    const entryRef = eventRef.collection(COLLECTIONS.entries).doc(ensembleId);
    const entrySnap = await entryRef.get();
    if (entrySnap.exists) {
      const entryData = entrySnap.data() || {};
      const entrySchoolId = String(entryData.schoolId || "");
      if (!entrySchoolId || entrySchoolId === schoolId) {
        await entryRef.delete();
        deletedEntries += 1;
      }
    }

    const scheduleSnap = await eventRef
        .collection(COLLECTIONS.schedule)
        .where(FIELDS.schedule.ensembleId, "==", ensembleId)
        .get();
    if (!scheduleSnap.empty) {
      const targetDocs = scheduleSnap.docs.filter((docSnap) => {
        const row = docSnap.data() || {};
        const rowSchoolId = String(row.schoolId || "");
        return !rowSchoolId || rowSchoolId === schoolId;
      });
      deletedSchedule += await deleteDocsInBatches(targetDocs);
    }
  }

  const submissionsSnap = await db
      .collection(COLLECTIONS.submissions)
      .where(FIELDS.submissions.ensembleId, "==", ensembleId)
      .get();
  if (!submissionsSnap.empty) {
    const targetDocs = submissionsSnap.docs.filter((docSnap) => {
      const row = docSnap.data() || {};
      const rowSchoolId = String(row.schoolId || "");
      return !rowSchoolId || rowSchoolId === schoolId;
    });
    deletedSubmissions += await deleteDocsInBatches(targetDocs);
  }

  const packetExportsSnap = await db
      .collection(COLLECTIONS.packetExports)
      .where(FIELDS.packetExports.ensembleId, "==", ensembleId)
      .get();
  if (!packetExportsSnap.empty) {
    const targetDocs = packetExportsSnap.docs.filter((docSnap) => {
      const row = docSnap.data() || {};
      const rowSchoolId = String(row.schoolId || "");
      return !rowSchoolId || rowSchoolId === schoolId;
    });
    deletedPacketExports += await deleteDocsInBatches(targetDocs);
  }

  const packetsSnap = await db
      .collection(COLLECTIONS.packets)
      .where(FIELDS.packets.ensembleId, "==", ensembleId)
      .get();
  if (!packetsSnap.empty) {
    for (const packetDoc of packetsSnap.docs) {
      const packetData = packetDoc.data() || {};
      const packetSchoolId = String(packetData.schoolId || "");
      if (packetSchoolId && packetSchoolId !== schoolId) continue;
      if (typeof db.recursiveDelete === "function") {
        await db.recursiveDelete(packetDoc.ref);
      } else {
        const sessionsSnap = await packetDoc.ref.collection("sessions").get();
        await deleteDocsInBatches(sessionsSnap.docs);
        const auditSnap = await packetDoc.ref.collection("audit").get();
        await deleteDocsInBatches(auditSnap.docs);
        await packetDoc.ref.delete();
      }
      deletedPackets += 1;
    }
  }

  await ensembleRef.delete();

  logger.info("deleteEnsemble force delete complete", {
    schoolId,
    ensembleId,
    deletedEntries,
    deletedSchedule,
    deletedSubmissions,
    deletedPackets,
    deletedPacketExports,
    actorUid: request.auth.uid,
  });

  return {
    deleted: true,
    forced: true,
    deletedEntries,
    deletedSchedule,
    deletedSubmissions,
    deletedPackets,
    deletedPacketExports,
  };
});

exports.renameEnsemble = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const schoolId = String(data.schoolId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const requestedName = String(data.name || "").trim();
  if (!schoolId || !ensembleId || !requestedName) {
    throw new HttpsError("invalid-argument", "schoolId, ensembleId, and name required.");
  }

  const db = admin.firestore();
  const userSnap = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  const userRole = userSnap.exists ? userSnap.data().role : null;
  const userSchoolId = userSnap.exists ? userSnap.data().schoolId : null;
  const isAdmin = isAdminProfile(userSnap.data() || {});
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
  const schoolSnap = await db.collection(COLLECTIONS.schools).doc(schoolId).get();
  const schoolName = schoolSnap.exists ? String(schoolSnap.data()?.name || "") : "";
  const name = normalizeEnsembleNameForSchool({schoolName, ensembleName: requestedName});

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

  const eventsSnap = await db.collection(COLLECTIONS.events).get();
  let updatedEntryCount = 0;
  let updatedScheduleCount = 0;
  for (const eventDoc of eventsSnap.docs) {
    const eventRef = db.collection(COLLECTIONS.events).doc(eventDoc.id);

    const entryRef = eventRef.collection(COLLECTIONS.entries).doc(ensembleId);
    const entrySnap = await entryRef.get();
    if (entrySnap.exists) {
      const entryData = entrySnap.data() || {};
      const entrySchoolId = String(entryData.schoolId || "");
      const entryEnsembleName = String(entryData.ensembleName || "");
      if ((!entrySchoolId || entrySchoolId === schoolId) && entryEnsembleName !== name) {
        await entryRef.set({
          ensembleName: name,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        updatedEntryCount += 1;
      }
    }

    const scheduleSnap = await eventRef
        .collection(COLLECTIONS.schedule)
        .where(FIELDS.schedule.ensembleId, "==", ensembleId)
        .get();
    if (!scheduleSnap.empty) {
      const scheduleBatch = db.batch();
      let scheduleWrites = 0;
      scheduleSnap.docs.forEach((docSnap) => {
        const row = docSnap.data() || {};
        const rowSchoolId = String(row.schoolId || "");
        const rowEnsembleName = String(row.ensembleName || "");
        if (rowSchoolId && rowSchoolId !== schoolId) return;
        if (rowEnsembleName === name) return;
        scheduleBatch.set(docSnap.ref, {
          [FIELDS.schedule.ensembleName]: name,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        scheduleWrites += 1;
      });
      if (scheduleWrites > 0) {
        await scheduleBatch.commit();
        updatedScheduleCount += scheduleWrites;
      }
    }
  }

  return {
    ok: true,
    ensembleId,
    name,
    updatedPacketCount,
    updatedEntryCount,
    updatedScheduleCount,
  };
});

exports.normalizeUnreleasedPacketNames = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const dryRun = data.dryRun !== false;
  const limitRaw = Number(data.limit || 0);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ?
    Math.min(Math.floor(limitRaw), 5000) :
    0;
  const statuses = ["draft", "reopened", "submitted", "locked"];
  const db = admin.firestore();

  let scanned = 0;
  let changed = 0;
  let updated = 0;
  let skippedNoSchool = 0;
  let skippedEmptyResult = 0;
  let lastDoc = null;

  let hasMore = true;
  while (hasMore) {
    let queryRef = db
        .collection(COLLECTIONS.packets)
        .where(FIELDS.packets.status, "in", statuses)
        .orderBy(FIELDS.packets.status)
        .limit(300);
    if (lastDoc) {
      queryRef = queryRef.startAfter(lastDoc);
    }
    const snap = await queryRef.get();
    if (snap.empty) {
      hasMore = false;
      continue;
    }

    const batch = db.batch();
    let batchWrites = 0;

    for (const docSnap of snap.docs) {
      if (limit > 0 && scanned >= limit) break;
      scanned += 1;

      const packet = docSnap.data() || {};
      const schoolName = String(packet.schoolName || "").trim();
      const ensembleName = String(packet.ensembleName || "").trim();
      if (!schoolName) {
        skippedNoSchool += 1;
        continue;
      }
      if (!ensembleName) {
        skippedEmptyResult += 1;
        continue;
      }

      const normalizedName = normalizeEnsembleNameForSchool({schoolName, ensembleName});
      if (!normalizedName || normalizedName === ensembleName) continue;

      changed += 1;
      if (dryRun) continue;

      const snapshot = packet.ensembleSnapshot && typeof packet.ensembleSnapshot === "object" ?
        {
          ...packet.ensembleSnapshot,
          ensembleName: normalizedName,
        } :
        null;
      const payload = {
        [FIELDS.packets.ensembleName]: normalizedName,
        [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (snapshot) {
        payload[FIELDS.packets.ensembleSnapshot] = snapshot;
      }
      batch.set(docSnap.ref, payload, {merge: true});
      batchWrites += 1;
      updated += 1;
    }

    if (!dryRun && batchWrites > 0) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (limit > 0 && scanned >= limit) {
      hasMore = false;
    }
  }

  return {
    ok: true,
    dryRun,
    scanned,
    changed,
    updated,
    skippedNoSchool,
    skippedEmptyResult,
  };
});

exports.normalizeEventEnsembleNames = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const dryRun = data.dryRun !== false;
  const eventIdFilter = String(data.eventId || "").trim();
  const limitRaw = Number(data.limit || 0);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ?
    Math.min(Math.floor(limitRaw), 10000) :
    0;
  const db = admin.firestore();

  const summary = {
    ok: true,
    dryRun,
    eventId: eventIdFilter || null,
    scanned: 0,
    changed: 0,
    updated: 0,
    scannedSchedule: 0,
    changedSchedule: 0,
    updatedSchedule: 0,
    scannedEntries: 0,
    changedEntries: 0,
    updatedEntries: 0,
    skippedEmptyResult: 0,
  };

  const eventIds = [];
  if (eventIdFilter) {
    const eventSnap = await db.collection(COLLECTIONS.events).doc(eventIdFilter).get();
    if (!eventSnap.exists) {
      throw new HttpsError("not-found", "Event not found.");
    }
    eventIds.push(eventIdFilter);
  } else {
    const eventsSnap = await db.collection(COLLECTIONS.events).get();
    eventsSnap.docs.forEach((docSnap) => eventIds.push(docSnap.id));
  }

  const processSubcollection = async ({eventId, subcollection, nameField, bucketKey}) => {
    let lastDoc = null;
    let hasMore = true;
    while (hasMore) {
      let queryRef = db
          .collection(COLLECTIONS.events)
          .doc(eventId)
          .collection(subcollection)
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(300);
      if (lastDoc) {
        queryRef = queryRef.startAfter(lastDoc);
      }
      const snap = await queryRef.get();
      if (snap.empty) {
        hasMore = false;
        continue;
      }

      const batch = db.batch();
      let batchWrites = 0;

      for (const docSnap of snap.docs) {
        if (limit > 0 && summary.scanned >= limit) {
          hasMore = false;
          break;
        }
        summary.scanned += 1;
        summary[`scanned${bucketKey}`] += 1;

        const data = docSnap.data() || {};
        const schoolName = String(data.schoolName || "").trim();
        const ensembleName = String(data[nameField] || "").trim();
        if (!ensembleName) {
          summary.skippedEmptyResult += 1;
          continue;
        }

        const normalizedName = normalizeEnsembleNameForSchool({schoolName, ensembleName});
        if (!normalizedName || normalizedName === ensembleName) continue;

        summary.changed += 1;
        summary[`changed${bucketKey}`] += 1;
        if (dryRun) continue;

        batch.set(docSnap.ref, {
          [nameField]: normalizedName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        batchWrites += 1;
        summary.updated += 1;
        summary[`updated${bucketKey}`] += 1;
      }

      if (!dryRun && batchWrites > 0) {
        await batch.commit();
      }

      lastDoc = snap.docs[snap.docs.length - 1];
      if (limit > 0 && summary.scanned >= limit) {
        hasMore = false;
      }
    }
  };

  for (const eventId of eventIds) {
    if (limit > 0 && summary.scanned >= limit) break;
    await processSubcollection({
      eventId,
      subcollection: COLLECTIONS.schedule,
      nameField: FIELDS.schedule.ensembleName,
      bucketKey: "Schedule",
    });
    if (limit > 0 && summary.scanned >= limit) break;
    await processSubcollection({
      eventId,
      subcollection: COLLECTIONS.entries,
      nameField: FIELDS.entries.ensembleName,
      bucketKey: "Entries",
    });
  }

  return summary;
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

exports.cleanupStalePacketArtifacts = onSchedule("15 3 * * *", async () => {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const nowMs = Date.now();
  const readyCutoffMs = nowMs - DIRECTOR_PACKET_EXPORT_RETENTION_MS;
  const staleFailureCutoffMs = nowMs - DIRECTOR_PACKET_EXPORT_STALE_FAILURE_MS;
  const orphanSessionCutoffMs = nowMs - ORPHAN_PACKET_SESSION_RETENTION_MS;

  const summary = {
    scannedExports: 0,
    deletedExports: 0,
    deletedExportFiles: 0,
    scannedSessions: 0,
    deletedOrphanSessions: 0,
  };

  let lastExportDoc = null;
  let hasMoreExports = true;
  while (hasMoreExports) {
    let queryRef = db
        .collection(COLLECTIONS.packetExports)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(300);
    if (lastExportDoc) queryRef = queryRef.startAfter(lastExportDoc);
    const snap = await queryRef.get();
    if (snap.empty) {
      hasMoreExports = false;
      continue;
    }

    for (const docSnap of snap.docs) {
      summary.scannedExports += 1;
      const data = docSnap.data() || {};
      const status = String(data.status || "");
      const generatedAt = data.generatedAt?.toMillis ? data.generatedAt.toMillis() : 0;
      const updatedAt = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0;
      const effectiveTs = Math.max(generatedAt, updatedAt, 0);
      const isReadyAndOld = status === "ready" && effectiveTs > 0 && effectiveTs < readyCutoffMs;
      const isFailedOrPendingAndOld =
        ["failed", "pending", "generating", "revoked"].includes(status) &&
        effectiveTs > 0 &&
        effectiveTs < staleFailureCutoffMs;

      if (!isReadyAndOld && !isFailedOrPendingAndOld) continue;

      if (isReadyAndOld) {
        const paths = new Set();
        const combinedPath = String(data.combinedPdfPath || "").trim();
        if (combinedPath) paths.add(combinedPath);
        const judgeAssets = data.judgeAssets && typeof data.judgeAssets === "object" ?
          data.judgeAssets :
          {};
        Object.values(judgeAssets).forEach((asset) => {
          const path = String(asset?.pdfPath || "").trim();
          if (path) paths.add(path);
        });
        for (const path of paths) {
          try {
            const file = bucket.file(path);
            const [exists] = await file.exists();
            if (!exists) continue;
            await file.delete();
            summary.deletedExportFiles += 1;
          } catch (error) {
            logger.warn("cleanupStalePacketArtifacts file delete failed", {
              path,
              error: error?.message || String(error),
            });
          }
        }
      }

      await docSnap.ref.delete();
      summary.deletedExports += 1;
    }
    lastExportDoc = snap.docs[snap.docs.length - 1];
  }

  const packetExistsCache = new Map();
  let lastSessionDoc = null;
  let hasMoreSessions = true;
  while (hasMoreSessions) {
    let queryRef = db
        .collectionGroup("sessions")
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(300);
    if (lastSessionDoc) queryRef = queryRef.startAfter(lastSessionDoc);
    const snap = await queryRef.get();
    if (snap.empty) {
      hasMoreSessions = false;
      continue;
    }

    for (const sessionDoc of snap.docs) {
      summary.scannedSessions += 1;
      const sessionData = sessionDoc.data() || {};
      const updatedAtMs = sessionData.updatedAt?.toMillis ? sessionData.updatedAt.toMillis() : 0;
      if (!updatedAtMs || updatedAtMs >= orphanSessionCutoffMs) continue;
      const packetRef = sessionDoc.ref.parent?.parent || null;
      if (!packetRef) continue;
      const packetPath = packetRef.path;
      let exists = packetExistsCache.get(packetPath);
      if (exists === undefined) {
        const packetSnap = await packetRef.get();
        exists = packetSnap.exists;
        packetExistsCache.set(packetPath, exists);
      }
      if (exists) continue;
      await sessionDoc.ref.delete();
      summary.deletedOrphanSessions += 1;
    }
    lastSessionDoc = snap.docs[snap.docs.length - 1];
  }

  logger.info("cleanupStalePacketArtifacts complete", summary);
  return summary;
});
