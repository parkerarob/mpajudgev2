const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {spawn} = require("child_process");
const ffmpegPath = require("ffmpeg-static");
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
const OPENAI_CHAT_TIMEOUT_MS = 45 * 1000;
const STAGE_OPENAI_CHAT_TIMEOUT_MS = 30 * 1000;
const OPENAI_DRAFT_MODEL = "gpt-5-mini";
const STAGE_OPENAI_DRAFT_MODEL = "gpt-4o-mini";
const MAX_TRANSCRIPT_CHARS = 12000;
const MAX_PARSE_TRANSCRIPT_INPUT_CHARS = 60000;
const MAX_STAGE_SYNTHESIS_TRANSCRIPT_CHARS = 10000;
const MAX_FINAL_CAPTION_WORDS = 140;
const PARSE_TRANSCRIPT_TIMEOUT_SECONDS = 300;
const DIRECTOR_PACKET_EXPORT_TTL_MS = 1000 * 60 * 30;
const DIRECTOR_PACKET_EXPORT_VERSION = "generated-v2";
const DIRECTOR_PACKET_EXPORT_RETENTION_MS = 1000 * 60 * 60 * 24 * 14;
const DIRECTOR_PACKET_EXPORT_STALE_FAILURE_MS = 1000 * 60 * 60 * 24 * 2;
const ORPHAN_PACKET_SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 2;
const ADJUDICATION_MODES = {
  practice: "practice",
  official: "official",
};
const EVENT_MODES = {
  live: "live",
  rehearsal: "rehearsal",
};
const READINESS_STEP_ORDER = [
  "rehearsalComplete",
  "judgeAudioCheck",
  "directorVisibilityCheck",
  "releaseGateCheck",
];
const READINESS_STEP_KEYS = new Set(READINESS_STEP_ORDER);
const MAX_READINESS_NOTE_LENGTH = 280;
const APP_CHECK_ENFORCEMENT_MODE = String(
    process.env.APP_CHECK_ENFORCEMENT_MODE || "deferred",
).trim().toLowerCase();
const ENFORCE_APP_CHECK = APP_CHECK_ENFORCEMENT_MODE === "enforced";
const DESTRUCTIVE_ADMIN_TOOLS_ENABLED = String(
    process.env.ALLOW_DESTRUCTIVE_ADMIN_TOOLS || "",
).trim().toLowerCase() === "true";
const RUNNING_IN_EMULATOR =
  process.env.FUNCTIONS_EMULATOR === "true" ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const CANONICAL_AUDIO_STATUS = {
  pending: "pending",
  ready: "ready",
  failed: "failed",
};
const GRADE_VALUES = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  F: 5,
};
const APPCHECK_SENSITIVE_OPTIONS = {enforceAppCheck: ENFORCE_APP_CHECK};
const APPCHECK_SENSITIVE_SECRET_OPTIONS = {
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [OPENAI_API_KEY],
};

let pdfLib = null;
let stageFormTemplateBytesPromise = null;
let sightFormTemplateBytesPromise = null;

function getPdfLib() {
  if (!pdfLib) {
    pdfLib = require("pdf-lib");
  }
  return pdfLib;
}

function pdfRgb(red = 0.08, green = 0.08, blue = 0.08) {
  return getPdfLib().rgb(red, green, blue);
}

async function getStageFormTemplateBytes() {
  if (!stageFormTemplateBytesPromise) {
    const templatePath = path.join(__dirname, "assets", "stage-form-template-fillable.pdf");
    stageFormTemplateBytesPromise = fs.readFile(templatePath);
  }
  return stageFormTemplateBytesPromise;
}

async function getSightFormTemplateBytes() {
  if (!sightFormTemplateBytesPromise) {
    const templatePath = path.join(__dirname, "assets", "sight-form-template-fillable.pdf");
    sightFormTemplateBytesPromise = fs.readFile(templatePath);
  }
  return sightFormTemplateBytesPromise;
}

function buildDirectorPacketExportId(eventId, ensembleId) {
  return `${eventId}_${ensembleId}`;
}

function buildStorageTokenUrl(bucketName, objectPath, token) {
  if (!bucketName || !objectPath || !token) return "";
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

function assertDestructiveAdminToolsAllowed(toolName = "This maintenance tool") {
  if (DESTRUCTIVE_ADMIN_TOOLS_ENABLED || RUNNING_IN_EMULATOR) {
    return;
  }
  throw new HttpsError(
      "failed-precondition",
      `${toolName} is disabled for this deployment.`,
  );
}

async function signStorageReadPath(path, {expiresAtMs = Date.now() + DIRECTOR_PACKET_EXPORT_TTL_MS} = {}) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  const bucket = admin.storage().bucket();
  try {
    const file = bucket.file(value);
    const [exists] = await file.exists();
    if (!exists) return "";
    try {
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAtMs,
      });
      if (url) return url;
    } catch (signedErr) {
      logger.warn("signStorageReadPath signed URL unavailable", {
        path: value,
        error: signedErr?.message || String(signedErr),
      });
    }
    const [metadata] = await file.getMetadata();
    const existingMetadata = metadata?.metadata && typeof metadata.metadata === "object" ?
      metadata.metadata :
      {};
    const existingTokenRaw =
      existingMetadata.firebaseStorageDownloadTokens ||
      metadata?.firebaseStorageDownloadTokens ||
      "";
    let token = String(existingTokenRaw || "")
        .split(",")
        .map((item) => item.trim())
        .find(Boolean);
    if (!token) {
      token = crypto.randomUUID();
      await file.setMetadata({
        metadata: {
          ...existingMetadata,
          firebaseStorageDownloadTokens: token,
        },
      });
    }
    if (!token) return "";
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(value)}?alt=media&token=${token}`;
  } catch (error) {
    logger.error("signStorageReadPath failed", {
      path: value,
      error: error?.message || String(error),
    });
    return "";
  }
}

async function runFfmpeg(args = []) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is not available.");
  }
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {stdio: ["ignore", "ignore", "pipe"]});
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function saveStorageObjectWithToken({
  bucket,
  objectPath,
  buffer,
  contentType = "audio/webm",
  metadata = {},
} = {}) {
  const token = crypto.randomUUID();
  await bucket.file(objectPath).save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      metadata: {
        ...metadata,
        firebaseStorageDownloadTokens: token,
      },
    },
  });
  return {
    path: objectPath,
    url: buildStorageTokenUrl(bucket.name, objectPath, token),
  };
}

async function buildCanonicalAudioAssetFromSegments({
  bucket,
  audioSegments,
  targetPath,
  metadata = {},
} = {}) {
  const normalized = normalizeAudioSegments(audioSegments || []);
  if (!normalized.length) {
    throw new Error("No audio segments available for canonical audio.");
  }

  const totalDurationSec = normalized.reduce((sum, segment) => {
    const value = Number(segment?.durationSec || 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);

  if (normalized.length === 1) {
    const segment = normalized[0];
    const objectPath = String(segment.audioPath || getStoragePathFromUrl(segment.audioUrl) || "").trim();
    if (!objectPath) {
      throw new Error("Unable to resolve single-segment audio path.");
    }
    const [buffer] = await bucket.file(objectPath).download();
    const saved = await saveStorageObjectWithToken({
      bucket,
      objectPath: targetPath,
      buffer,
      contentType: "audio/webm",
      metadata,
    });
    return {
      ...saved,
      durationSec: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
      sourceSegments: normalized,
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mpa-audio-"));
  try {
    const concatListPath = path.join(tempDir, "concat.txt");
    const inputPaths = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const segment = normalized[index];
      const objectPath = String(segment.audioPath || getStoragePathFromUrl(segment.audioUrl) || "").trim();
      if (!objectPath) {
        throw new Error(`Unable to resolve audio path for segment ${index + 1}.`);
      }
      const localPath = path.join(tempDir, `segment_${String(index).padStart(3, "0")}.webm`);
      await bucket.file(objectPath).download({destination: localPath});
      inputPaths.push(localPath);
    }
    const concatContents = inputPaths
        .map((localPath) => `file '${localPath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
        .join("\n");
    await fs.writeFile(concatListPath, concatContents, "utf8");
    const outputPath = path.join(tempDir, "canonical.webm");
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      outputPath,
    ]);
    const outputBuffer = await fs.readFile(outputPath);
    const saved = await saveStorageObjectWithToken({
      bucket,
      objectPath: targetPath,
      buffer: outputBuffer,
      contentType: "audio/webm",
      metadata,
    });
    return {
      ...saved,
      durationSec: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
      sourceSegments: normalized,
    };
  } finally {
    await fs.rm(tempDir, {recursive: true, force: true}).catch(() => {});
  }
}

async function ensurePacketCanonicalAudio({
  packetRef,
  packet,
  packetId = "",
  eventId = "",
  ensembleId = "",
  judgePosition = "",
  force = false,
} = {}) {
  if (!packetRef) {
    throw new Error("packetRef required.");
  }
  const currentPacket = packet || {};
  const existingPath = String(currentPacket.canonicalAudioPath || "").trim();
  const existingUrl = String(currentPacket.canonicalAudioUrl || "").trim();
  const existingStatus = String(currentPacket.canonicalAudioStatus || "").trim();
  const existingDuration = Number(currentPacket.canonicalAudioDurationSec || 0);
  if (!force && existingStatus === CANONICAL_AUDIO_STATUS.ready && existingPath && existingUrl) {
    return {
      path: existingPath,
      url: existingUrl,
      durationSec: Number.isFinite(existingDuration) ? existingDuration : Number(currentPacket.tapeDurationSec || 0),
      sourceSegments: normalizeAudioSegments(currentPacket.audioSegments || []),
    };
  }

  await packetRef.set({
    canonicalAudioStatus: CANONICAL_AUDIO_STATUS.pending,
    canonicalAudioError: "",
    canonicalAudioUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  try {
    const sessionsSnap = await packetRef.collection("sessions").orderBy("startedAt", "asc").get();
    const audioSegments = buildAudioSegmentsFromSessionSnapshots(sessionsSnap.docs);
    if (!audioSegments.length) {
      throw new Error("No uploaded audio segments available.");
    }
    const bucket = admin.storage().bucket();
    const objectPath = eventId && ensembleId && judgePosition ?
      `canonical_audio/${eventId}/${ensembleId}/${judgePosition}.webm` :
      `canonical_audio/open/${packetId || packetRef.id}.webm`;
    const canonical = await buildCanonicalAudioAssetFromSegments({
      bucket,
      audioSegments,
      targetPath: objectPath,
      metadata: {
        packetId: packetId || packetRef.id,
        eventId,
        ensembleId,
        judgePosition,
        assetType: "canonical-audio",
      },
    });
    await packetRef.set({
      canonicalAudioStatus: CANONICAL_AUDIO_STATUS.ready,
      canonicalAudioPath: canonical.path,
      canonicalAudioUrl: canonical.url,
      canonicalAudioDurationSec: canonical.durationSec,
      canonicalAudioError: "",
      [FIELDS.packets.audioSegments]: canonical.sourceSegments,
      [FIELDS.packets.tapeDurationSec]: canonical.durationSec,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      canonicalAudioUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    return canonical;
  } catch (error) {
    await packetRef.set({
      canonicalAudioStatus: CANONICAL_AUDIO_STATUS.failed,
      canonicalAudioError: String(error?.message || error),
      canonicalAudioUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    throw error;
  }
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
  color = null,
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
      color: color || pdfRgb(0.08, 0.08, 0.08),
    });
  });
  return y - (Math.min(lines.length, maxLines) * lineHeight);
}

function drawFieldCommentOverlay({
  page,
  font,
  rect,
  text,
  inset = 1.5,
  size = 7.2,
  lineHeight = 8.1,
  maxLines = 4,
} = {}) {
  if (!page || !font || !rect) return;
  page.drawRectangle({
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0, rect.width - (inset * 2)),
    height: Math.max(0, rect.height - (inset * 2)),
    color: pdfRgb(1, 1, 1),
  });
  const value = String(text || "").trim();
  if (!value) return;
  drawWrappedText({
    page,
    font,
    text: value,
    x: rect.x + 5,
    y: rect.y + rect.height - 8,
    maxWidth: Math.max(0, rect.width - 10),
    size,
    lineHeight,
    color: pdfRgb(0.08, 0.08, 0.08),
    maxLines,
  });
}

const EVENT_TIMEZONE = "America/New_York";

function formatDateLabel(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    timeZone: EVENT_TIMEZONE,
  });
}

function formatTimeLabel(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    timeZone: EVENT_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadStageSubmissionContext({
  db,
  eventId,
  ensembleId,
  schoolId,
} = {}) {
  const schoolRef = schoolId ? db.collection(COLLECTIONS.schools).doc(schoolId) : null;
  const directorQuery = schoolId ?
    db.collection(COLLECTIONS.users)
        .where(FIELDS.users.role, "==", "director")
        .where(FIELDS.users.schoolId, "==", schoolId)
        .limit(1) :
    null;

  const [schoolSnap, directorSnap] = await Promise.all([
    schoolRef ? schoolRef.get() : Promise.resolve(null),
    directorQuery ? directorQuery.get() : Promise.resolve(null),
  ]);

  const school = schoolSnap && schoolSnap.exists ? (schoolSnap.data() || {}) : {};
  const director = directorSnap && !directorSnap.empty ? (directorSnap.docs[0].data() || {}) : {};
  if (!eventId || !ensembleId) {
    return {
      event: {},
      entry: {},
      schedule: {},
      school,
      director,
    };
  }

  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const entryRef = eventRef.collection(COLLECTIONS.entries).doc(ensembleId);
  const scheduleQuery = eventRef
      .collection(COLLECTIONS.schedule)
      .where(FIELDS.schedule.ensembleId, "==", ensembleId)
      .limit(1);
  const [eventSnap, entrySnap, scheduleSnap] = await Promise.all([
    eventRef.get(),
    entryRef.get(),
    scheduleQuery.get(),
  ]);

  const event = eventSnap.exists ? (eventSnap.data() || {}) : {};
  const entry = entrySnap.exists ? (entrySnap.data() || {}) : {};
  const scheduleDoc = !scheduleSnap.empty ? (scheduleSnap.docs[0].data() || {}) : {};
  return {
    event,
    entry,
    schedule: scheduleDoc,
    school,
    director,
  };
}

async function renderStageSubmissionTemplatePdf({
  eventId,
  ensembleId,
  schoolId,
  grade,
  position,
  submission,
  context = {},
} = {}) {
  const {PDFDocument, StandardFonts, TextAlignment} = getPdfLib();
  const pdfDoc = await PDFDocument.load(await getStageFormTemplateBytes());
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const form = pdfDoc.getForm();
  const captions = submission?.captions && typeof submission.captions === "object" ?
    submission.captions :
    {};
  const entry = context.entry && typeof context.entry === "object" ? context.entry : {};
  const schedule = context.schedule && typeof context.schedule === "object" ? context.schedule : {};
  const school = context.school && typeof context.school === "object" ? context.school : {};
  const director = context.director && typeof context.director === "object" ? context.director : {};
  const judgeName = String(submission?.judgeName || submission?.judgeEmail || "Unknown Judge");
  const displayEnsemble = String(
      schedule.ensembleName ||
      entry.ensembleName ||
      ensembleId ||
      "",
  ).trim();
  const displaySchool = String(
      schedule.schoolName ||
      entry.schoolName ||
      school.name ||
      schoolId ||
      "",
  ).trim();
  const displayDirector = String(director.displayName || director.email || "").trim();
  const performanceGrade = String(entry.performanceGrade || grade || "").trim();
  const finalRating = String(submission?.computedFinalRatingLabel || "").trim();
  const scheduleDate = formatDateLabel(schedule.performanceAt || context.event?.startAt || null);
  const scheduleTime = formatTimeLabel(schedule.performanceAt || null);
  const repertoire = entry.repertoire && typeof entry.repertoire === "object" ? entry.repertoire : {};
  const commentOverlays = [];
  const fieldNameMap = {
    ensembleName: ["ensembleName", "01KKHMB0J9CB29FMWE20GBYYCW"],
    schoolName: ["schoolName", "01KKHN0BA3G9JPJV7DG32Q9E6N"],
    siteLabel: ["01KKY6AY2FXB7S7GRATV7HRSTK"],
    directorName: ["directorName", "01KKHN0RKP65BWJ4T27Y8AH2ZN"],
    eventDate: ["eventDate", "01KKHN11PFTBQ86FJ1YJKZ16WC"],
    eventTime: ["eventTime", "01KKHN1D60CDKMR9QN6NBXZW0P"],
    performanceGrade: ["performanceGrade", "01KKHN1VS3HVXJ487RSPZSN6BS"],
    memberCount: ["memberCount", "01KKHN1NR98KS5SRRA619XGD3F"],
    marchComposer: ["marchComposer", "01KKHN2Z4S2KSN2FGNX6HXP4ME"],
    marchTitle: ["marchTitle", "01KKHN2C6Z8G09VWY1XN0H07TY"],
    marchGrade: ["marchGrade", "01KKHN3Q4XD1HM86JVGMKBAE9Y"],
    selection1Composer: ["selection1Composer", "01KKHN3B5QNKHGP48AJTFWW4PR"],
    selection1Grade: ["selection1Grade", "01KKHN3ZMG0P97PBYE968KP3AN"],
    selection1Title: ["selection1Title", "01KKHN2NG5BVQVRFTYFEEX1S7E"],
    selection2Composer: ["selection2Composer", "01KKHN3FG3DHQ9NV468Q5714W1"],
    selection2Grade: ["selection2Grade", "01KKHN44CCPR0W2B24G00BTS6J"],
    selection2Title: ["selection2Title", "01KKHN2T203Y26PZJ1ZPX7ZY28"],
    finalRating: ["finalRating", "01KKHMAEHMNV6JGSASBY304AMS"],
    adjudicatorSignatureName: ["adjudicatorSignatureName", "01KKHM7Q2D9702C0T1NXD1R3EA"],
    toneQualityComment: ["toneQualityComment", "01KKHM1WWE5BBPQEQXG3TBY0XF"],
    toneQualityGrade: ["toneQualityGrade", "01KKHM89J6BG3PHXF55NCQ1M29"],
    intonationComment: ["intonationComment", "01KKHM254TNG0FHDPVGWYBMWPS"],
    intonationGrade: ["intonationGrade", "01KKHM967CD3DQZ0MWWCQVB2B8"],
    balanceBlendComment: ["balanceBlendComment", "01KKHM2DPZG2TFMCTMD7Y3467V"],
    balanceBlendGrade: ["balanceBlendGrade", "01KKHM9C1VP8Q8S72TEF68596D"],
    precisionComment: ["precisionComment", "01KKHM2XF5HAEACREZ9HFZMYYS"],
    precisionGrade: ["precisionGrade", "01KKHM9HWP34Q5ARQQ2G8GQ0NY"],
    basicMusicianshipComment: ["basicMusicianshipComment", "01KKHM2JE46W3EWSBQP7283D52"],
    basicMusicianshipGrade: ["basicMusicianshipGrade", "01KKHM9P6FFX7YNJMXYKRQXTWZ"],
    interpretiveMusicianshipComment: [
      "interpretiveMusicianshipComment",
      "01KKHM343F5CWFAX44KYD2SN0J",
    ],
    interpretiveMusicianshipGrade: ["interpretiveMusicianshipGrade", "01KKHM9V4J3GPJM3A7EJDC33EK"],
    generalFactorsComment: ["generalFactorsComment", "01KKHM7CDC5CW4RNCYKMF8YCVR"],
    generalFactorsGrade: ["generalFactorsGrade", "01KKHM9ZWC19YN4S3AC83F8MRF"],
  };
  const getTextField = (semanticName) => {
    const candidates = fieldNameMap[semanticName] || [semanticName];
    for (const candidate of candidates) {
      try {
        return form.getTextField(candidate);
      } catch {
        continue;
      }
    }
    throw new Error(`Missing PDF field for ${semanticName}`);
  };
  const setFieldText = (semanticName, value, options = {}) => {
    const textField = getTextField(semanticName);
    if (options.alignment !== undefined) {
      textField.setAlignment(options.alignment);
    }
    if (options.fontSize !== undefined) {
      textField.setFontSize(options.fontSize);
    }
    textField.setText(String(value || "").trim());
  };

  setFieldText("ensembleName", displayEnsemble);
  setFieldText("schoolName", displaySchool);
  try {
    setFieldText("siteLabel", "South Site | Ashley High School, Wilmington, NC", {fontSize: 9});
  } catch {
    // Older template variant without the site field.
  }
  setFieldText("directorName", displayDirector);
  setFieldText("eventDate", scheduleDate);
  setFieldText("eventTime", scheduleTime);
  setFieldText("memberCount", "NCBA Eastern");
  setFieldText("performanceGrade", performanceGrade);
  setFieldText("finalRating", finalRating, {alignment: TextAlignment.Center});
  setFieldText("marchTitle", repertoire.march?.title || "");
  setFieldText("selection1Title", repertoire.selection1?.title || "");
  setFieldText("selection2Title", repertoire.selection2?.title || "");
  setFieldText("marchComposer", repertoire.march?.composer || "");
  setFieldText("selection1Composer", repertoire.selection1?.composer || "");
  setFieldText("selection2Composer", repertoire.selection2?.composer || "");
  setFieldText("marchGrade", "");
  setFieldText("selection1Grade", repertoire.selection1?.grade || "");
  setFieldText("selection2Grade", repertoire.selection2?.grade || "");
  setFieldText("adjudicatorSignatureName", judgeName);

  const captionFieldMap = {
    toneQuality: {comment: "toneQualityComment", grade: "toneQualityGrade"},
    intonation: {comment: "intonationComment", grade: "intonationGrade"},
    balanceBlend: {comment: "balanceBlendComment", grade: "balanceBlendGrade"},
    precision: {comment: "precisionComment", grade: "precisionGrade"},
    basicMusicianship: {
      comment: "basicMusicianshipComment",
      grade: "basicMusicianshipGrade",
    },
    interpretativeMusicianship: {
      comment: "interpretiveMusicianshipComment",
      grade: "interpretiveMusicianshipGrade",
    },
    generalFactors: {comment: "generalFactorsComment", grade: "generalFactorsGrade"},
  };

  Object.entries(captionFieldMap).forEach(([key, fields]) => {
    const value = captions[key] || {};
    const commentField = getTextField(fields.comment);
    const widget = commentField.acroField.getWidgets()[0] || null;
    const rect = widget?.getRectangle ? widget.getRectangle() : null;
    commentField.setText("");
    if (rect) {
      commentOverlays.push({
        rect,
        text: String(value.comment || "").trim(),
      });
    }
    setFieldText(
        fields.grade,
        `${value.gradeLetter || ""}${value.gradeModifier || ""}`.trim(),
        {alignment: TextAlignment.Center},
    );
  });

  form.updateFieldAppearances(font);
  form.flatten();
  const firstPage = pdfDoc.getPages()[0] || null;
  commentOverlays.forEach(({rect, text}) => {
    drawFieldCommentOverlay({
      page: firstPage,
      font,
      rect,
      text,
      size: 7,
      lineHeight: 8,
      maxLines: 4,
    });
  });
  return await pdfDoc.save();
}

async function renderSightSubmissionTemplatePdf({
  eventId,
  ensembleId,
  schoolId,
  grade,
  position,
  submission,
  context = {},
} = {}) {
  const {PDFDocument, TextAlignment} = getPdfLib();
  const pdfDoc = await PDFDocument.load(await getSightFormTemplateBytes());
  const font = await pdfDoc.embedFont(getPdfLib().StandardFonts.Helvetica);
  const form = pdfDoc.getForm();
  const captions = submission?.captions && typeof submission.captions === "object" ?
    submission.captions :
    {};
  const schedule = context.schedule && typeof context.schedule === "object" ? context.schedule : {};
  const school = context.school && typeof context.school === "object" ? context.school : {};
  const entry = context.entry && typeof context.entry === "object" ? context.entry : {};
  const judgeName = String(submission?.judgeName || submission?.judgeEmail || "Unknown Judge").trim();
  const fieldNameMap = {
    finalRating: ["01KKY6PKC6V2BQWB75QBZ837KB"],
    schoolName: ["01KKHS9H5QKWN1K5PBZ4EQR1E7"],
    ensembleName: ["01KKHS909B5XX1VGV95X0Y1RTA"],
    eventTime: ["01KKHSAZQWFSB3D3C2P4JEEVEA"],
    eventDate: ["01KKHSB5M0MPN1R4KS14F84EWP"],
    memberCount: ["01KKHSATKZ30T6Q2DWBN2T6TNQ"],
    performanceGrade: ["01KKHSAF0TGGGM5SX3469WZW6B"],
    toneQualityGrade: ["01KKY6PVSRGPP61K5D9V681DK6"],
    toneQualityComment: ["01KKHSBD94FCKZAA418GECW6WK"],
    intonationGrade: ["01KKY6Q9VRRBCNK0TY92YY3SET"],
    intonationComment: ["01KKHSC78KYSCBF64XDMKGPTA2"],
    balanceGrade: ["01KKY6QV1VV2TF3AJGY0J4H06K"],
    balanceComment: ["01KKHSCDFYHT373E8BPD58VQ5B"],
    techniqueGrade: ["01KKY6R29G1F7SHNQPGH75J2VP"],
    techniqueComment: ["01KKHSCKTV2DDF4145K6ZEFQXJ"],
    rhythmGrade: ["01KKY6R8A1N8C30J0J43MMW1TJ"],
    rhythmComment: ["01KKHSCZJ6DJBHSGXP490HS1QF"],
    musicianshipGrade: ["01KKY6RR864K4M2E5DTWMD4R33"],
    musicianshipComment: ["01KKHSD4JSH1CW0N9YW70ATY0F"],
    prepTimeGrade: ["01KKY6RWN8G55E06SM9A7EGBZ0"],
    prepTimeComment: ["01KKHSDW5B2SYYY10YXK2VAJ6R"],
    adjudicatorSignatureName: ["01KKY6S7MDC9WWTSS8BCMFEFM0"],
  };
  const getTextField = (semanticName) => {
    const candidates = fieldNameMap[semanticName] || [semanticName];
    for (const candidate of candidates) {
      try {
        return form.getTextField(candidate);
      } catch {
        continue;
      }
    }
    throw new Error(`Missing PDF field for ${semanticName}`);
  };
  const setFieldText = (semanticName, value, options = {}) => {
    const textField = getTextField(semanticName);
    if (options.alignment !== undefined) {
      textField.setAlignment(options.alignment);
    }
    if (options.fontSize !== undefined) {
      textField.setFontSize(options.fontSize);
    }
    textField.setText(String(value || "").trim());
  };

  const displayEnsemble = String(
      schedule.ensembleName ||
      entry.ensembleName ||
      ensembleId ||
      "",
  ).trim();
  const displaySchool = String(
      schedule.schoolName ||
      entry.schoolName ||
      school.name ||
      schoolId ||
      "",
  ).trim();
  const scheduleDate = formatDateLabel(schedule.performanceAt || context.event?.startAt || null);
  const scheduleTime = formatTimeLabel(schedule.performanceAt || null);

  setFieldText("ensembleName", displayEnsemble);
  setFieldText("schoolName", displaySchool);
  setFieldText("eventDate", scheduleDate);
  setFieldText("eventTime", scheduleTime);
  setFieldText("memberCount", "NCBA Eastern");
  setFieldText("performanceGrade", String(grade || "").trim());
  setFieldText("finalRating", String(submission?.computedFinalRatingLabel || "N/A").trim(), {
    alignment: TextAlignment.Center,
  });
  setFieldText("adjudicatorSignatureName", judgeName);

  const commentOverlays = [];
  const captionFieldMap = {
    toneQuality: {comment: "toneQualityComment", grade: "toneQualityGrade"},
    intonation: {comment: "intonationComment", grade: "intonationGrade"},
    balance: {comment: "balanceComment", grade: "balanceGrade"},
    technique: {comment: "techniqueComment", grade: "techniqueGrade"},
    rhythm: {comment: "rhythmComment", grade: "rhythmGrade"},
    musicianship: {comment: "musicianshipComment", grade: "musicianshipGrade"},
    prepTime: {comment: "prepTimeComment", grade: "prepTimeGrade"},
  };
  Object.entries(captionFieldMap).forEach(([key, fields]) => {
    const value = captions[key] || {};
    const commentField = getTextField(fields.comment);
    const widget = commentField.acroField.getWidgets()[0] || null;
    const rect = widget?.getRectangle ? widget.getRectangle() : null;
    commentField.setText("");
    if (rect) {
      commentOverlays.push({rect, text: String(value.comment || "").trim()});
    }
    setFieldText(
        fields.grade,
        `${value.gradeLetter || ""}${value.gradeModifier || ""}`.trim(),
        {alignment: TextAlignment.Center},
    );
  });

  form.updateFieldAppearances(font);
  form.flatten();
  const firstPage = pdfDoc.getPages()[0] || null;
  commentOverlays.forEach(({rect, text}) => {
    drawFieldCommentOverlay({
      page: firstPage,
      font,
      rect,
      text,
      size: 7,
      lineHeight: 8,
      maxLines: 4,
    });
  });
  return await pdfDoc.save();
}

async function renderSubmissionTemplatePdf({
  eventId,
  ensembleId,
  schoolId,
  grade,
  position,
  submission,
  context = {},
} = {}) {
  if (position !== JUDGE_POSITIONS.sight) {
    return renderStageSubmissionTemplatePdf({
      eventId,
      ensembleId,
      schoolId,
      grade,
      position,
      submission,
      context,
    });
  }
  return renderSightSubmissionTemplatePdf({
    eventId,
    ensembleId,
    schoolId,
    grade,
    position,
    submission,
    context,
  });
}

async function renderOpenPacketPrintablePdf({
  packetId,
  packet,
  context = {},
} = {}) {
  const resolvedPacket = packet && typeof packet === "object" ? packet : {};
  const formType = resolvedPacket.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
  const submissionLike = {
    judgeName: resolvedPacket.createdByJudgeName || "",
    judgeEmail: resolvedPacket.createdByJudgeEmail || "",
    captions: resolvedPacket.captions && typeof resolvedPacket.captions === "object" ?
      resolvedPacket.captions :
      {},
    captionScoreTotal: Number.isFinite(Number(resolvedPacket.captionScoreTotal)) ?
      Number(resolvedPacket.captionScoreTotal) :
      0,
    computedFinalRatingLabel: resolvedPacket.computedFinalRatingLabel || "N/A",
  };
  const renderContext = {
    ...context,
    entry:
      context.entry ||
      resolvedPacket.directorEntrySnapshot ||
      null,
    schedule: context.schedule || {
      schoolName: resolvedPacket.schoolName || "",
      ensembleName: resolvedPacket.ensembleName || "",
      performanceAt: null,
    },
    school: context.school || {
      name: resolvedPacket.schoolName || "",
    },
  };

  if (formType === FORM_TYPES.stage) {
    return renderStageSubmissionTemplatePdf({
      eventId: String(resolvedPacket.officialEventId || resolvedPacket.assignmentEventId || "").trim(),
      ensembleId: String(resolvedPacket.ensembleName || resolvedPacket.ensembleId || packetId || "").trim(),
      schoolId: String(resolvedPacket.schoolId || "").trim(),
      grade: String(
          renderContext.entry?.performanceGrade ||
          resolvedPacket.directorEntrySnapshot?.performanceGrade ||
          "",
      ).trim(),
      position:
        normalizeOpenPacketJudgePosition(
            resolvedPacket.officialJudgePosition ||
            resolvedPacket.judgePosition,
        ) || JUDGE_POSITIONS.stage1,
      submission: submissionLike,
      context: renderContext,
    });
  }

  return renderSightSubmissionTemplatePdf({
    eventId: String(resolvedPacket.officialEventId || resolvedPacket.assignmentEventId || "").trim(),
    ensembleId: String(resolvedPacket.ensembleName || resolvedPacket.ensembleId || packetId || "").trim(),
    schoolId: String(resolvedPacket.schoolName || resolvedPacket.schoolId || "").trim(),
    grade: String(
        renderContext.entry?.performanceGrade ||
        resolvedPacket.directorEntrySnapshot?.performanceGrade ||
        "",
    ).trim(),
    position:
      normalizeOpenPacketJudgePosition(
          resolvedPacket.officialJudgePosition ||
          resolvedPacket.judgePosition,
      ) || JUDGE_POSITIONS.sight,
    submission: submissionLike,
    context: renderContext,
  });
}

async function generateDirectorPacketExportInternal({
  eventId,
  ensembleId,
  grade,
  actorUid = "",
} = {}) {
  const {PDFDocument} = getPdfLib();
  if (!eventId || !ensembleId || !grade) {
    throw new Error("eventId, ensembleId, and grade are required for export.");
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const positions = requiredPositionsForGrade(grade);
  const [officialDocs, submissionDocs] = await Promise.all([
    Promise.all(
        positions.map((position) =>
          db.collection(COLLECTIONS.officialAssessments).doc(`${eventId}_${ensembleId}_${position}`).get(),
        ),
    ),
    Promise.all(
        positions.map((position) =>
          db.collection(COLLECTIONS.submissions).doc(`${eventId}_${ensembleId}_${position}`).get(),
        ),
    ),
  ]);
  const submissionsByPosition = {};
  buildCanonicalPacketAssessments({
    positions,
    officialDocs,
    submissionDocs,
  }).forEach((item) => {
    submissionsByPosition[item.position] = item.assessment;
  });

  const schoolId = String(submissionsByPosition[positions[0]]?.schoolId || "");
  const renderContext = await loadStageSubmissionContext({
    db,
    eventId,
    ensembleId,
    schoolId,
  });

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
      context: renderContext,
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
      audioUrl: String(submission.canonicalAudioUrl || submission.audioUrl || ""),
      audioPath: String(
          submission.canonicalAudioPath ||
          submission.audioPath ||
          getStoragePathFromUrl(submission.canonicalAudioUrl || submission.audioUrl) ||
          "",
      ),
      audioDurationSec: Number(
          submission.canonicalAudioDurationSec ||
          submission.audioDurationSec ||
          0,
      ),
      audioSegments: normalizeAudioSegments(submission.audioSegments || []),
      supplementalAudioDurationSec: Number(submission.supplementalAudioDurationSec || 0),
      supplementalAudioPath: String(submission.supplementalAudioPath || ""),
      supplementalAudioUrl: String(submission.supplementalAudioUrl || ""),
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

async function loadCanonicalPacketAssessmentsForEvent({db, eventId, ensembleId, grade} = {}) {
  const positions = requiredPositionsForGrade(grade);
  const [officialDocs, submissionDocs] = await Promise.all([
    Promise.all(
        positions.map((position) =>
          db.collection(COLLECTIONS.officialAssessments).doc(`${eventId}_${ensembleId}_${position}`).get(),
        ),
    ),
    Promise.all(
        positions.map((position) =>
          db.collection(COLLECTIONS.submissions).doc(`${eventId}_${ensembleId}_${position}`).get(),
        ),
    ),
  ]);
  return buildCanonicalPacketAssessments({
    positions,
    officialDocs,
    submissionDocs,
  });
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
  let lastTranscriptionError = null;

  if (objectPath) {
    const file = bucket.file(objectPath);
    const [exists] = await file.exists();
    if (exists) {
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size || 0);
      if (size <= MAX_AUDIO_BYTES) {
        const [buffer] = await file.download();
        const contentType = metadata.contentType || "audio/webm";
        try {
          transcript = await transcribeAudioBuffer(buffer, contentType, apiKey);
        } catch (error) {
          lastTranscriptionError = error;
          logger.warn("master audio transcription failed; falling back to chunks", {
            packetId: packetRef.id,
            sessionId,
            objectPath,
            error: error?.message || String(error),
          });
        }
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
          const match = file.name.match(/chunk_(\d+)\.webm$/);
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
      try {
        const text = await transcribeAudioBuffer(buffer, contentType, apiKey);
        if (text) parts.push(text);
      } catch (error) {
        lastTranscriptionError = error;
        logger.warn("chunk transcription failed; skipping chunk", {
          packetId: packetRef.id,
          sessionId,
          chunkPath: item.file.name,
          error: error?.message || String(error),
        });
      }
      if (parts.join(" ").length >= MAX_TRANSCRIPT_CHARS) break;
    }
    transcript = parts.join(" ").trim();
  }

  if (!transcript) {
    if (lastTranscriptionError) {
      throw new HttpsError(
          "failed-precondition",
          "No transcribable audio found for this segment.",
      );
    }
    throw new HttpsError("not-found", "Audio file not found.");
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

function trimWords(text, maxWords) {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function truncateForModelInput(text = "", maxChars = MAX_PARSE_TRANSCRIPT_INPUT_CHARS) {
  const value = String(text || "");
  if (value.length <= maxChars) return value;
  const half = Math.floor(maxChars / 2);
  return `${value.slice(0, half)}\n...\n${value.slice(-half)}`;
}

function normalizeGroundingText(value) {
  return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
}

function sanitizeCaptionText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return raw
      // remove section/theme labels that leak from internal compression
      .replace(/\b[a-z ]+(?:section|performance):\s*[a-z/ ]+\s*-\s*/gi, "")
      .replace(/\b(?:early|middle|late)\s+performance:\s*[a-z/ ]+\s*-\s*/gi, "")
      .replace(/\b[a-z ]+:\s*(?:tone quality|intonation|balance\/blend|precision|rhythm\/pulse|musicianship\/style)\s*-\s*/gi, "")
      // collapse repeated dots and awkward punctuation artifacts
      .replace(/\.{2,}/g, ".")
      .replace(/([!?.,])\1+/g, "$1")
      .replace(/[–—]+/g, "-")
      .replace(/\s*-\s*which\b/gi, ", which")
      .replace(/\s+([,.;!?])/g, "$1")
      .replace(/(^|[.!?]\s+)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`)
      .replace(/\b([A-Za-z]+)\s+\1\b/gi, "$1")
      .replace(/\b(?:and|or|but|so)\s*$/i, "")
      .replace(/\b(?:with|to|for|of|in)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
}

function normalizeDraftContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const directorEntrySummary =
    source.directorEntrySummary && typeof source.directorEntrySummary === "object" ?
      source.directorEntrySummary :
      {};
  return {
    schoolName: String(source.schoolName || "").trim(),
    ensembleName: String(source.ensembleName || "").trim(),
    judgePosition: String(source.judgePosition || "").trim(),
    performanceGrade: String(source.performanceGrade || "").trim(),
    assignmentEventId: String(source.assignmentEventId || "").trim(),
    directorEntrySummary: {
      performanceGrade: String(directorEntrySummary.performanceGrade || "").trim(),
      performanceGradeFlex: Boolean(directorEntrySummary.performanceGradeFlex),
      repertoire: directorEntrySummary.repertoire && typeof directorEntrySummary.repertoire === "object" ?
        directorEntrySummary.repertoire :
        {},
      instrumentation:
        directorEntrySummary.instrumentation &&
        typeof directorEntrySummary.instrumentation === "object" ?
          directorEntrySummary.instrumentation :
          {},
    },
  };
}

function extractTranscriptDirectives(transcript = "", maxDirectives = 12) {
  const text = String(transcript || "").trim();
  if (!text) return [];
  const directiveTokens = [
    "want",
    "need",
    "make sure",
    "be careful",
    "should",
    "must",
    "do not",
    "don't",
    "remember",
    "wanna",
  ];
  const sentences = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  const selected = [];
  for (const sentence of sentences) {
    const normalized = normalizeGroundingText(sentence);
    if (!normalized) continue;
    if (!directiveTokens.some((token) => normalized.includes(token))) continue;
    selected.push(trimWords(sentence, 24));
    if (selected.length >= maxDirectives) break;
  }
  return selected;
}

function hasLoudSoftBalanceDirective(transcript = "") {
  const normalized = normalizeGroundingText(transcript);
  if (!normalized) return false;
  const loudBrass = /(trumpet|brass).{0,48}(loud|louder|forte)|(?:loud|louder|forte).{0,48}(trumpet|brass)/.test(normalized);
  const softWoodwind = /(woodwind|clarinet|bass clarinet|alto).{0,64}(soft|softer|mezzo piano|mezzo forte|mp|mf)|(?:soft|softer|mezzo piano|mezzo forte|mp|mf).{0,64}(woodwind|clarinet|bass clarinet|alto)/.test(normalized);
  return loudBrass && softWoodwind;
}

function enforceBalanceHierarchyDirective(captionText = "", transcriptDirectives = []) {
  const text = String(captionText || "").trim();
  if (!text) return text;
  const normalized = normalizeGroundingText(text);
  const inversionPattern = /(woodwinds?|clarinets?).{0,50}(dominat|stronger|lead).{0,40}(soft|mezzo)|(?:soft|mezzo).{0,50}(woodwinds?|clarinets?).{0,40}(dominat|stronger|lead)/.test(normalized) &&
    /(brass|trumpet).{0,50}(shines?|dominates?|already)/.test(normalized);
  if (inversionPattern) {
    return "Prioritize role-based hierarchy: in softer sections, aim for woodwind color to carry mp/mf texture; in louder sections, let trumpet/brass core project at forte. Keep harmony support from overpowering moving lines.";
  }
  const hasLoudBrass =
    (normalized.includes("loud") || normalized.includes("forte")) &&
    (normalized.includes("brass") || normalized.includes("trumpet"));
  const hasSoftWoodwind =
    (normalized.includes("soft") || normalized.includes("mezzo")) &&
    (normalized.includes("woodwind") || normalized.includes("clarinet"));
  if (hasLoudBrass && hasSoftWoodwind) return text;
  const directiveTail = (transcriptDirectives || []).length ?
    " This matches the judge directive to prioritize woodwind color at mp/mf and brass core at forte." :
    "";
  return `${text} In louder sections, allow trumpet/brass core to project; in softer sections, prioritize woodwind color.${directiveTail}`;
}

function toSnakeCaseKey(value = "") {
  return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s/-]+/g, "_")
      .toLowerCase();
}

function buildCaptionKeyCandidates(canonicalKey = "") {
  const key = String(canonicalKey || "").trim();
  if (!key) return [];
  const snake = toSnakeCaseKey(key);
  const candidates = new Set([key, snake]);
  const aliases = {
    balanceBlend: ["balance_blend"],
    basicMusicianship: ["basic_musicianship"],
    interpretativeMusicianship: ["interpretive_musicianship", "interpretative_musicianship"],
    toneQuality: ["tone_quality"],
    generalFactors: ["general_factors"],
    prepTime: ["prep_time"],
  };
  (aliases[key] || []).forEach((alias) => candidates.add(alias));
  return Array.from(candidates);
}

function pickFirstCaptionValueFromObject(source = {}, keyCandidates = []) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keyCandidates) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function extractCaptionTextFromModelValue(value) {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const cleaned = sanitizeCaptionText(value);
    return cleaned || null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if (value.included === false) {
    return null;
  }
  if (value.comment === null) {
    return null;
  }
  const rawComment = typeof value.comment === "string" ? value.comment : "";
  if (!rawComment.trim()) {
    return null;
  }
  const cleaned = sanitizeCaptionText(rawComment);
  return cleaned || null;
}

function hasForbiddenCaptionStyle(text = "") {
  const value = String(text || "").trim();
  const normalized = value.toLowerCase();
  if (!normalized) return false;

  const bannedStarts = [
    "multiple references",
    "explicit reference",
    "several observations",
    "several timing",
    "comments about",
    "notes about",
    "the adjudicator mentioned",
    "interpretive/style comments",
    "instrumentation and literature remarks",
  ];

  if (bannedStarts.some((prefix) => normalized.startsWith(prefix))) return true;
  if (normalized.startsWith("several ")) return true;
  if (normalized.includes("\":")) return true;
  if (normalized.includes("observations:")) return true;
  if (normalized.includes("references:")) return true;
  if (normalized.includes("remarks:")) return true;
  if (normalized.includes("throughout:")) return true;
  if ((value.match(/["“”]/g) || []).length >= 2) return true;

  return false;
}

function capSentenceCount(text = "", maxSentences = 4) {
  const value = String(text || "").trim();
  if (!value) return "";
  const sentences = value
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  if (sentences.length <= maxSentences) return value;
  return sentences.slice(0, maxSentences).join(" ");
}

function transcriptSupportsGeneralFactors(transcript = "") {
  const normalized = normalizeGroundingText(transcript);
  if (!normalized) return false;
  const literaturePattern = /\b(literature|repertoire|piece selection|selection appropriateness|appropriate literature)\b/;
  const instrumentationPattern = /\b(instrumentation|instrumentation list|scoring|instrumentation coverage|missing instrumentation)\b/;
  const appearancePattern = /\b(appearance|uniform|presentation|stage presence)\b/;
  const etiquettePattern = /\b(etiquette|concert etiquette|performance etiquette|audience etiquette|on stage behavior|stage behavior)\b/;
  return (
    literaturePattern.test(normalized) ||
    instrumentationPattern.test(normalized) ||
    appearancePattern.test(normalized) ||
    etiquettePattern.test(normalized)
  );
}

function transcriptSupportsBasicMusicianship(transcript = "") {
  const normalized = normalizeGroundingText(transcript);
  if (!normalized) return false;
  const printedDynamicsPattern = /\b(printed dynamic|printed dynamics|dynamic contrast|dynamics|crescendo|decrescendo)\b/;
  const tempoChangesPattern = /\b(printed tempo|tempo change|tempo changes|ritard|ritardando|accelerando|a tempo|rubato)\b/;
  const mutePattern = /\b(mute|mutes|straight mute|cup mute|harmon mute)\b/;
  const percussionImplementsPattern = /\b(percussion implement|implements|mallet|mallets|sticks|stick choice|beater|beaters|brushes)\b/;
  return (
    printedDynamicsPattern.test(normalized) ||
    tempoChangesPattern.test(normalized) ||
    mutePattern.test(normalized) ||
    percussionImplementsPattern.test(normalized)
  );
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
  if (lower === "checkin" || lower === "check-in" || lower === "check_in") {
    return "checkin";
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

function isJudgeProfile(profile = {}) {
  return normalizeRoleValue(profile.role) === "judge" || profile.roles?.judge === true;
}

function getEffectiveRole(profile = {}) {
  const normalizedRole = normalizeRoleValue(profile.role);
  if (normalizedRole) return normalizedRole;
  if (profile.roles?.admin === true) return "admin";
  if (profile.roles?.teamLead === true) return "teamLead";
  if (profile.roles?.director === true) return "director";
  if (profile.roles?.judge === true) return "judge";
  if (profile.roles?.checkin === true) return "checkin";
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

function normalizeEventMode(value) {
  return String(value || "").trim().toLowerCase() === EVENT_MODES.rehearsal ?
    EVENT_MODES.rehearsal :
    EVENT_MODES.live;
}

function normalizeAssignmentUid(value) {
  return String(value || "").trim();
}

function buildAssignmentChecks(assignments = {}) {
  const stage1Uid = normalizeAssignmentUid(assignments.stage1Uid);
  const stage2Uid = normalizeAssignmentUid(assignments.stage2Uid);
  const stage3Uid = normalizeAssignmentUid(assignments.stage3Uid);
  const sightUid = normalizeAssignmentUid(assignments.sightUid);
  const allPresent = Boolean(stage1Uid && stage2Uid && stage3Uid && sightUid);
  const unique = allPresent &&
    new Set([stage1Uid, stage2Uid, stage3Uid, sightUid]).size === 4;
  return {
    stage1Uid,
    stage2Uid,
    stage3Uid,
    sightUid,
    allPresent,
    unique,
  };
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

function normalizeAudioSegments(audioSegments = []) {
  if (!Array.isArray(audioSegments)) return [];
  return audioSegments
      .map((segment, index) => {
        const audioUrl = String(segment?.audioUrl || "").trim();
        const audioPath = String(segment?.audioPath || "").trim();
        if (!audioUrl && !audioPath) return null;
        const durationSec = Number(segment?.durationSec || 0);
        const sortOrder = Number(segment?.sortOrder ?? index);
        return {
          sessionId: String(segment?.sessionId || segment?.id || `segment_${index + 1}`),
          label: String(segment?.label || `Part ${index + 1}`),
          audioUrl,
          audioPath,
          durationSec: Number.isFinite(durationSec) ? durationSec : 0,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
          startedAtMs: Number(segment?.startedAtMs || 0) || 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        if (a.startedAtMs !== b.startedAtMs) return a.startedAtMs - b.startedAtMs;
        return a.label.localeCompare(b.label);
      });
}

function buildAudioSegmentsFromSessionSnapshots(sessionDocs = []) {
  return normalizeAudioSegments(
      sessionDocs.map((docSnap, index) => {
        const session = docSnap.data() || {};
        return {
          sessionId: docSnap.id,
          label: `Part ${index + 1}`,
          audioUrl: String(session.masterAudioUrl || "").trim(),
          audioPath: String(
              session.masterAudioPath ||
              getStoragePathFromUrl(session.masterAudioUrl) ||
              "",
          ).trim(),
          durationSec: Number(session.durationSec || 0),
          sortOrder: index,
          startedAtMs: session.startedAt?.toMillis ? session.startedAt.toMillis() : 0,
        };
      }),
  );
}

async function signAudioSegments(audioSegments = [], {expiresAtMs} = {}) {
  const normalized = normalizeAudioSegments(audioSegments);
  const signed = [];
  for (const segment of normalized) {
    const signedUrl = segment.audioPath ?
      await signStorageReadPath(segment.audioPath, {expiresAtMs}) :
      "";
    signed.push({
      ...segment,
      audioUrl: signedUrl || segment.audioUrl || "",
    });
  }
  return signed;
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

function normalizeAdjudicationMode(value) {
  return value === ADJUDICATION_MODES.official ?
    ADJUDICATION_MODES.official :
    ADJUDICATION_MODES.practice;
}

async function assertOfficialPacketEligibility({
  db,
  eventId,
  schoolId,
  ensembleId,
}) {
  if (!eventId || !schoolId || !ensembleId) {
    throw new HttpsError(
        "failed-precondition",
        "Official adjudication requires active event, school, and ensemble.",
    );
  }
  const scheduleSnap = await db
      .collection(COLLECTIONS.events)
      .doc(eventId)
      .collection(COLLECTIONS.schedule)
      .where(FIELDS.schedule.schoolId, "==", schoolId)
      .where(FIELDS.schedule.ensembleId, "==", ensembleId)
      .limit(1)
      .get();
  if (scheduleSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Official adjudication must target a scheduled ensemble in the active event.",
    );
  }
}

function isSubmissionReady(submission) {
  if (!submission) return false;
  if (submission.status !== STATUSES.submitted) return false;
  if (submission.locked !== true) return false;
  if (!submission.audioUrl) return false;
  if (String(submission.canonicalAudioStatus || CANONICAL_AUDIO_STATUS.ready) !== CANONICAL_AUDIO_STATUS.ready) {
    return false;
  }
  if (!submission.captions) return false;
  if (Object.keys(submission.captions).length < 7) return false;
  if (typeof submission.captionScoreTotal !== "number") return false;
  if (typeof submission.computedFinalRatingJudge !== "number") return false;
  return true;
}

function normalizeCanonicalPacketAssessment({official = null, submission = null} = {}) {
  if (official) {
    return {
      ...(submission || {}),
      ...official,
      locked: true,
      status: official.status === STATUSES.released ? STATUSES.released : STATUSES.submitted,
      canonicalAudioStatus:
        submission?.canonicalAudioStatus ||
        CANONICAL_AUDIO_STATUS.ready,
      canonicalAudioUrl:
        official.audioUrl ||
        submission?.canonicalAudioUrl ||
        submission?.audioUrl ||
        "",
      canonicalAudioPath:
        official.audioPath ||
        submission?.canonicalAudioPath ||
        submission?.audioPath ||
        "",
      canonicalAudioDurationSec:
        Number(official.audioDurationSec || submission?.canonicalAudioDurationSec || submission?.audioDurationSec || 0),
    };
  }
  return submission || null;
}

function buildCanonicalPacketAssessments({positions = [], officialDocs = [], submissionDocs = []} = {}) {
  return positions.map((position, index) => {
    const official = officialDocs[index]?.exists ? (officialDocs[index].data() || null) : null;
    const submission = submissionDocs[index]?.exists ? (submissionDocs[index].data() || null) : null;
    return {
      position,
      label: judgeLabelByPosition(position),
      assessment: normalizeCanonicalPacketAssessment({official, submission}),
      official,
      submission,
    };
  });
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

function normalizeReviewState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "excluded") return "excluded";
  if (normalized === "in_review") return "in_review";
  return "pending";
}

function buildRawAssessmentId({packetId, rawAssessmentId} = {}) {
  return String(rawAssessmentId || packetId || "").trim();
}

function buildOfficialAssessmentId({eventId, ensembleId, judgePosition} = {}) {
  return `${String(eventId || "").trim()}_${String(ensembleId || "").trim()}_${String(judgePosition || "").trim()}`;
}

function buildExpectedPacketOfficialSubmissionId(packet = {}) {
  const eventId = String(packet.officialEventId || packet.assignmentEventId || "").trim();
  const ensembleId = String(packet.ensembleId || "").trim();
  const judgePosition = String(packet.officialJudgePosition || packet.judgePosition || "").trim();
  if (!eventId || !ensembleId || !judgePosition) return "";
  return buildOfficialAssessmentId({eventId, ensembleId, judgePosition});
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

async function deleteDocsInBatches(db, docs, chunkSize = 400) {
  if (!docs || !docs.length) return 0;
  let totalDeleted = 0;
  for (let idx = 0; idx < docs.length; idx += chunkSize) {
    const chunk = docs.slice(idx, idx + chunkSize);
    const batch = db.batch();
    chunk.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    totalDeleted += chunk.length;
  }
  return totalDeleted;
}

function isReleasedOpenPacketStatus(value) {
  return String(value || "").trim() === "released";
}

async function deleteOpenPacketDocument({
  db,
  bucket,
  packetRef,
  packet,
  packetId,
}) {
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

  const auditSnap = await packetRef.collection("audit").get();
  const deletedSessionCount = await deleteDocsInBatches(db, sessionsSnap.docs);
  const deletedAuditCount = await deleteDocsInBatches(db, auditSnap.docs);
  await packetRef.delete();
  return {
    deletedSessionCount,
    deletedAuditCount,
  };
}

function computeOpenPacketTranscriptStateFromSessions(sessionDocs = []) {
  const completedSessions = sessionDocs
      .map((docSnap) => ({id: docSnap.id, ...(docSnap.data() || {})}))
      .filter((session) => String(session.status || "") === "completed");
  const transcriptFull = completedSessions
      .map((session) => String(session.transcript || "").trim())
      .filter(Boolean)
      .join(" ")
      .trim()
      .slice(0, MAX_TRANSCRIPT_CHARS);
  const completeCount = completedSessions.filter(
      (session) => String(session.transcriptStatus || "").toLowerCase() === "complete",
  ).length;
  const failedCount = completedSessions.filter(
      (session) => String(session.transcriptStatus || "").toLowerCase() === "failed",
  ).length;
  const hasCompleted = completedSessions.length > 0;
  const transcriptStatus = !hasCompleted ?
    "idle" :
    failedCount > 0 && completeCount === 0 ?
      "failed" :
      failedCount > 0 ?
        "partial" :
        completeCount >= completedSessions.length ?
          "complete" :
          "running";
  return {
    transcriptFull,
    transcriptStatus,
    transcriptError: failedCount > 0 ? "One or more recording parts failed." : "",
  };
}

function buildOpenPacketSessionStatePatch({
  packet = {},
  sessionDocs = [],
  deletedSessionId = "",
} = {}) {
  const audioSegments = buildAudioSegmentsFromSessionSnapshots(sessionDocs);
  const primaryAudio = audioSegments[0] || null;
  const totalDurationSec = audioSegments.reduce((sum, segment) => {
    const value = Number(segment?.durationSec || 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const transcriptState = computeOpenPacketTranscriptStateFromSessions(sessionDocs);
  const remainingSessionIds = new Set(sessionDocs.map((docSnap) => docSnap.id));
  const activeSessionId = String(packet.activeSessionId || "").trim();

  return {
    [FIELDS.packets.audioSegments]: audioSegments,
    [FIELDS.packets.audioSessionCount]: sessionDocs.length,
    [FIELDS.packets.segmentCount]: sessionDocs.length,
    [FIELDS.packets.latestAudioUrl]: primaryAudio?.audioUrl || "",
    [FIELDS.packets.latestAudioPath]: primaryAudio?.audioPath || "",
    [FIELDS.packets.tapeDurationSec]: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
    [FIELDS.packets.transcript]: transcriptState.transcriptFull,
    [FIELDS.packets.transcriptFull]: transcriptState.transcriptFull,
    [FIELDS.packets.transcriptStatus]: transcriptState.transcriptStatus,
    [FIELDS.packets.transcriptError]: transcriptState.transcriptError,
    [FIELDS.packets.activeSessionId]:
      activeSessionId &&
      activeSessionId !== deletedSessionId &&
      remainingSessionIds.has(activeSessionId) ?
        activeSessionId :
        null,
    canonicalAudioStatus: "pending",
    canonicalAudioPath: "",
    canonicalAudioUrl: "",
    canonicalAudioDurationSec: 0,
    canonicalAudioError: "",
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function deleteOpenPacketSessionDocument({
  bucket,
  packet,
  packetId,
  sessionRef,
  sessionId,
  session = {},
}) {
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
      logger.warn("deleteOpenPacketSession master audio delete failed", {
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
      logger.warn("deleteOpenPacketSession chunk delete failed", {
        packetId,
        sessionId,
        chunkPrefix,
        error: error?.message || String(error),
      });
    }
  }

  await sessionRef.delete();
}

async function deleteScheduledPacketGroup({
  db,
  eventId,
  ensembleId,
}) {
  const positions = Object.values(JUDGE_POSITIONS);
  const submissionRefs = positions.map((position) =>
    db.collection(COLLECTIONS.submissions).doc(`${eventId}_${ensembleId}_${position}`),
  );
  const officialRefs = positions.map((position) =>
    db.collection(COLLECTIONS.officialAssessments).doc(`${eventId}_${ensembleId}_${position}`),
  );
  const [submissionSnaps, officialSnaps] = await Promise.all([
    Promise.all(submissionRefs.map((ref) => ref.get())),
    Promise.all(officialRefs.map((ref) => ref.get())),
  ]);
  const submissionDocs = submissionSnaps.filter((docSnap) => docSnap.exists);
  const officialDocs = officialSnaps.filter((docSnap) => docSnap.exists);
  if (!submissionDocs.length && !officialDocs.length) {
    return {
      found: false,
      hasReleased: false,
      deletedSubmissions: 0,
      deletedOfficialAssessments: 0,
      deletedPacketExport: 0,
    };
  }

  const canonicalAssessments = buildCanonicalPacketAssessments({
    positions,
    officialDocs: officialSnaps,
    submissionDocs: submissionSnaps,
  });
  const hasReleased = canonicalAssessments.some((item) => item.assessment?.status === STATUSES.released);
  if (hasReleased) {
    return {
      found: true,
      hasReleased: true,
      deletedSubmissions: 0,
      deletedOfficialAssessments: 0,
      deletedPacketExport: 0,
    };
  }

  const deletedSubmissions = await deleteDocsInBatches(db, submissionDocs);
  const deletedOfficialAssessments = await deleteDocsInBatches(db, officialDocs);
  let deletedPacketExport = 0;
  const exportRef = db
      .collection(COLLECTIONS.packetExports)
      .doc(buildDirectorPacketExportId(eventId, ensembleId));
  const exportSnap = await exportRef.get();
  if (exportSnap.exists) {
    await exportRef.delete();
    deletedPacketExport = 1;
  }

  return {
    found: true,
    hasReleased: false,
    deletedSubmissions,
    deletedOfficialAssessments,
    deletedPacketExport,
  };
}

async function deleteScheduledAssessmentAtPosition({
  db,
  eventId,
  ensembleId,
  judgePosition,
}) {
  const assessmentId = `${eventId}_${ensembleId}_${judgePosition}`;
  const submissionRef = db.collection(COLLECTIONS.submissions).doc(assessmentId);
  const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(assessmentId);
  const [submissionSnap, officialSnap] = await Promise.all([
    submissionRef.get(),
    officialRef.get(),
  ]);
  if (!submissionSnap.exists && !officialSnap.exists) {
    return {
      found: false,
      hasReleased: false,
      deletedSubmissions: 0,
      deletedOfficialAssessments: 0,
      revertedRawAssessments: 0,
      revertedPackets: 0,
      deletedPacketExport: 0,
    };
  }

  const canonical = officialSnap.exists ? (officialSnap.data() || {}) : (submissionSnap.data() || {});
  const canonicalStatus = String(canonical.status || "").trim().toLowerCase();
  if (canonicalStatus === STATUSES.released) {
    return {
      found: true,
      hasReleased: true,
      deletedSubmissions: 0,
      deletedOfficialAssessments: 0,
      revertedRawAssessments: 0,
      revertedPackets: 0,
      deletedPacketExport: 0,
    };
  }

  let revertedRawAssessments = 0;
  let revertedPackets = 0;
  const sourceRawAssessmentId = String(officialSnap.data()?.sourceRawAssessmentId || "").trim();
  if (sourceRawAssessmentId) {
    const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(sourceRawAssessmentId);
    const rawSnap = await rawRef.get();
    if (rawSnap.exists) {
      const raw = rawSnap.data() || {};
      await rawRef.set({
        [FIELDS.rawAssessments.status]: STATUSES.submitted,
        [FIELDS.rawAssessments.reviewState]: "pending",
        [FIELDS.rawAssessments.officialAssessmentId]: "",
        [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      revertedRawAssessments = 1;

      const packetId = String(raw.packetId || "").trim();
      if (packetId) {
        await db.collection(COLLECTIONS.packets).doc(packetId).set({
          [FIELDS.packets.officialAssessmentId]: "",
          [FIELDS.packets.reviewState]: "pending",
          [FIELDS.packets.captureStatus]: STATUSES.submitted,
          [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        revertedPackets = 1;
      }
    }
  }

  const deletedSubmissions = submissionSnap.exists ? await deleteDocsInBatches(db, [submissionSnap]) : 0;
  const deletedOfficialAssessments = officialSnap.exists ? await deleteDocsInBatches(db, [officialSnap]) : 0;
  let deletedPacketExport = 0;
  const exportRef = db
      .collection(COLLECTIONS.packetExports)
      .doc(buildDirectorPacketExportId(eventId, ensembleId));
  const exportSnap = await exportRef.get();
  if (exportSnap.exists) {
    await exportRef.delete();
    deletedPacketExport = 1;
  }

  return {
    found: true,
    hasReleased: false,
    deletedSubmissions,
    deletedOfficialAssessments,
    revertedRawAssessments,
    revertedPackets,
    deletedPacketExport,
  };
}

exports.parseTranscript = onCall(
    {
      ...APPCHECK_SENSITIVE_SECRET_OPTIONS,
      maxInstances: 30,
      timeoutSeconds: PARSE_TRANSCRIPT_TIMEOUT_SECONDS,
    },
    async (request) => {
      await assertRole(request, ["judge", "admin"]);
      await checkRateLimit(request.auth.uid, "parseTranscript", 20, 60);
      const data = request.data || {};
      const formType = data.formType;
      let transcript = String(data.transcript || "");
      const metadataContext = normalizeDraftContext(data.context || {});

      if (![FORM_TYPES.stage, FORM_TYPES.sight].includes(formType)) {
        throw new HttpsError("invalid-argument", "Invalid formType.");
      }
      if (transcript.length > MAX_PARSE_TRANSCRIPT_INPUT_CHARS) {
        transcript = truncateForModelInput(transcript, MAX_PARSE_TRANSCRIPT_INPUT_CHARS);
      }

      const template = CAPTION_TEMPLATES[formType] || [];
      const categories = template.map((item) => ({
        key: item.key,
        label: item.label,
      }));

      if (!transcript || !transcript.trim()) {
        const emptyCaptions = template.reduce((acc, item) => {
          acc[item.key] = formType === FORM_TYPES.stage ? null : "";
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

      const transcriptDirectives = extractTranscriptDirectives(transcript);
      const loudSoftBalanceDirective = hasLoudSoftBalanceDirective(transcript);
      const transcriptForModel =
        formType === FORM_TYPES.stage ?
          truncateForModelInput(transcript, MAX_STAGE_SYNTHESIS_TRANSCRIPT_CHARS) :
          transcript;
      const buildDraftRequestBody = ({messages, model = OPENAI_DRAFT_MODEL} = {}) => {
        const body = {
          model,
          response_format: {type: "json_object"},
          messages,
        };
        return body;
      };
      const callDraftModel = async ({
        systemPrompt,
        userPrompt,
        timeoutMs = OPENAI_CHAT_TIMEOUT_MS,
        model = OPENAI_DRAFT_MODEL,
      } = {}) => {
        const response = await fetchWithTimeout(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(buildDraftRequestBody({
                model,
                messages: [
                  {role: "system", content: systemPrompt},
                  {role: "user", content: userPrompt},
                ],
              })),
            },
            timeoutMs,
        );
        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Caption draft failed", {
            status: response.status,
            body: errorText.slice(0, 500),
          });
          throw new HttpsError("internal", "Caption drafting failed.");
        }
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content || "";
        if (!content) return {};
        try {
          return JSON.parse(content);
        } catch (error) {
          logger.error("Caption draft JSON parse failed", {
            error: String(error?.message || error),
            content: content.slice(0, 500),
          });
          throw new HttpsError("internal", "Caption drafting failed.");
        }
      };

      const stageSynthesisPrompt = [
        "You are an experienced NCBA-style concert band adjudicator filling out the Concert Band Stage Form.",
        "Write one finished comment for each supported caption as a director-facing adjudicator paragraph.",
        "Use only information explicitly supported by the transcript. Do not invent observations or move evidence to the wrong caption.",
        "If support is weak, return included=false and comment=null.",
        "General Factors only if literature appropriateness, instrumentation, appearance, or etiquette is explicitly discussed.",
        "Basic Musicianship only if printed dynamics, dynamic contrast, tempo changes, mutes, or percussion implements are explicitly discussed.",
        "Each included comment must be 3 to 4 sentences and read like a finished stage-sheet remark, not notes or an evidence summary.",
        "Sentence 1 states the main musical takeaway. Sentence 2 describes the repeated pattern. Sentence 3 adds one specific context, contrast, or result. Sentence 4 is optional and must stay supported.",
        "Do not use quotation marks, colon-led evidence lists, meta-language, or phrases like Multiple references, Explicit reference, Several observations, Comments about, Notes about, or The adjudicator mentioned.",
        "Return JSON only with canonical caption keys and values shaped as {included, comment}.",
      ].join("\n");

      const sightSynthesisPrompt = [
        "You are writing NCBA-style adjudication caption comments from a spoken judge transcript.",
        "Write from the same voice and intent as the transcript.",
        "Use only information present in the transcript and provided context.",
        "Do not invent facts, instrumentation, score markings, measures, or performance details.",
        "For each canonical caption key, write a concise final summary comment that aligns to that caption.",
        "If evidence is not meaningful for a caption, omit it by setting included=false and comment=null.",
        "Do not include grades (A/B/C/D/F), plus/minus, bullets, labels, or prefixed section tags.",
        "Return only valid JSON where each caption key maps to: {\"included\":true|false,\"comment\":\"...\"|null}.",
      ].join("\n");

      const synthesisPrompt = formType === FORM_TYPES.stage ? stageSynthesisPrompt : sightSynthesisPrompt;
      const sightFallbackPrompt = [
        "NCBA sight-reading caption writer.",
        "Use only explicit transcript evidence and do not invent.",
        "Omit unsupported captions with included=false and comment=null.",
        "Return JSON only with canonical caption keys and {included, comment}.",
      ].join("\n");

      const synthesisUserPrompt =
        formType === FORM_TYPES.stage ?
          [
            `Form Type: ${formType}`,
            "",
            "Canonical Captions:",
            categories.map((c) => `${c.key}: ${c.label}`).join("\n"),
            "",
            "Transcript:",
            transcriptForModel,
          ].join("\n") :
          [
            `Form Type: ${formType}`,
            "",
            "Canonical Captions:",
            categories.map((c) => `${c.key}: ${c.label}`).join("\n"),
            "",
            "Performance Metadata:",
            JSON.stringify(metadataContext, null, 2),
            "",
            "Transcript:",
            transcriptForModel,
          ].join("\n");
      const sightFallbackUserPrompt = [
        `Form Type: ${formType}`,
        "Canonical Captions:",
        categories.map((c) => `${c.key}: ${c.label}`).join("\n"),
        "",
        "Transcript:",
        truncateForModelInput(transcriptForModel, 20000),
      ].join("\n");

      let synthesisResult = {};
      let usedFallback = false;
      let draftStatus = "generated";
      let draftMessage = "";
      try {
        synthesisResult = await callDraftModel({
          systemPrompt: synthesisPrompt,
          userPrompt: synthesisUserPrompt,
          timeoutMs: formType === FORM_TYPES.stage ? STAGE_OPENAI_CHAT_TIMEOUT_MS : OPENAI_CHAT_TIMEOUT_MS,
          model: formType === FORM_TYPES.stage ? STAGE_OPENAI_DRAFT_MODEL : OPENAI_DRAFT_MODEL,
        });
      } catch (error) {
        logger.error("parseTranscript synthesis failed", {
          uid: request.auth.uid,
          formType,
          transcriptLength: transcript.length,
          error: String(error?.message || error),
        });
        if (formType !== FORM_TYPES.stage) {
          try {
            synthesisResult = await callDraftModel({
              systemPrompt: sightFallbackPrompt,
              userPrompt: sightFallbackUserPrompt,
            });
            usedFallback = true;
          } catch (fallbackError) {
            logger.error("parseTranscript fallback synthesis failed", {
              uid: request.auth.uid,
              formType,
              transcriptLength: transcript.length,
              error: String(fallbackError?.message || fallbackError),
            });
            synthesisResult = {};
            draftStatus = "model_failed";
            draftMessage = "Drafting failed before captions were generated.";
          }
        } else {
          synthesisResult = {};
          draftStatus = "model_failed";
          draftMessage = "Drafting timed out or failed before captions were generated.";
        }
      }

      const captions = {};
      const modelRoot = synthesisResult && typeof synthesisResult === "object" ? synthesisResult : {};
      const modelCaptionsRaw =
        modelRoot.captions && typeof modelRoot.captions === "object" ?
          modelRoot.captions :
          {};
      const perKeyLog = {};

      template.forEach((item) => {
        const key = item.key;
        const keyCandidates = buildCaptionKeyCandidates(key);
        const rawValue =
          pickFirstCaptionValueFromObject(modelCaptionsRaw, keyCandidates) ??
          pickFirstCaptionValueFromObject(modelRoot, keyCandidates);
        let caption = extractCaptionTextFromModelValue(rawValue);

        if (
          formType === FORM_TYPES.stage &&
          key === "generalFactors" &&
          !transcriptSupportsGeneralFactors(transcript)
        ) {
          caption = null;
        }

        if (
          formType === FORM_TYPES.stage &&
          key === "basicMusicianship" &&
          !transcriptSupportsBasicMusicianship(transcript)
        ) {
          caption = null;
        }
        if (
          caption &&
          caption.trim() &&
          loudSoftBalanceDirective &&
          (formType === FORM_TYPES.sight && key === "balance")
        ) {
          caption = enforceBalanceHierarchyDirective(caption, transcriptDirectives);
        }
        let finalCaption = caption ? trimWords(capSentenceCount(sanitizeCaptionText(caption), 4), MAX_FINAL_CAPTION_WORDS) : null;
        if (formType === FORM_TYPES.stage && finalCaption && hasForbiddenCaptionStyle(finalCaption)) {
          finalCaption = null;
        }
        if (!finalCaption && formType !== FORM_TYPES.stage) {
          finalCaption = "";
        }
        captions[key] = finalCaption;
        const omitted = formType === FORM_TYPES.stage ? finalCaption === null : !finalCaption;
        perKeyLog[key] = {
          usedFallback,
          omitted,
          styleRejected: formType === FORM_TYPES.stage && caption !== null && finalCaption === null,
          generatedLength: finalCaption ? finalCaption.length : 0,
        };
      });

      const generatedCount = Object.values(captions).reduce((count, value) => {
        if (typeof value === "string") {
          return count + (value.trim() ? 1 : 0);
        }
        return count + (value !== null && value !== undefined ? 1 : 0);
      }, 0);
      const omittedCount = template.length - generatedCount;
      const styleRejectedCount = Object.values(perKeyLog).reduce(
          (count, item) => count + (item.styleRejected ? 1 : 0),
          0,
      );

      if (draftStatus === "generated" && generatedCount === 0) {
        draftStatus = "no_supported_captions";
        draftMessage = "Drafting returned no usable captions.";
      }

      logger.info("parseTranscript evidenceSummary", {
        formType,
        transcriptLength: transcript.length,
        draftStatus,
        generatedCount,
        omittedCount,
        styleRejectedCount,
        perKey: perKeyLog,
      });

      return {
        captions,
        formType,
        meta: {
          status: draftStatus,
          generatedCount,
          omittedCount,
          styleRejectedCount,
          usedFallback,
          message: draftMessage || null,
        },
      };
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

      const normalizedAudioSegments = normalizeAudioSegments(submission.audioSegments || []);
      let objectPath =
        String(normalizedAudioSegments[0]?.audioPath || "").trim() ||
        getStoragePathFromUrl(submission.audioUrl);
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
  const mode = normalizeAdjudicationMode(data.mode);
  const assignment = useActiveEventDefaults ?
    await resolveActiveEventAssignmentForUser(request.auth.uid) :
    null;
  if (mode === ADJUDICATION_MODES.official && !assignment) {
    throw new HttpsError(
        "failed-precondition",
        "Official adjudication requires an active event judge assignment.",
    );
  }
  const officialEventId = mode === ADJUDICATION_MODES.official ?
    String(assignment?.eventId || "").trim() :
    "";
  const officialJudgePosition = mode === ADJUDICATION_MODES.official ?
    String(assignment?.judgePosition || "").trim() :
    "";
  if (mode === ADJUDICATION_MODES.official) {
    await assertOfficialPacketEligibility({
      db: admin.firestore(),
      eventId: officialEventId,
      schoolId,
      ensembleId,
    });
  }
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
    [FIELDS.packets.assignmentMode]: mode === ADJUDICATION_MODES.official ?
      "official" :
      (assignment ? "activeEventDefault" : "open"),
    [FIELDS.packets.mode]: mode,
    [FIELDS.packets.officialEventId]: officialEventId,
    [FIELDS.packets.officialJudgePosition]: officialJudgePosition,
    [FIELDS.packets.officialSubmissionId]: "",
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
    [FIELDS.packets.audioSegments]: [],
    canonicalAudioStatus: "pending",
    canonicalAudioPath: "",
    canonicalAudioUrl: "",
    canonicalAudioDurationSec: 0,
    canonicalAudioError: "",
    canonicalAudioUpdatedAt: null,
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
  if (typeof prefs.judgeAdjudicationMode === "string") {
    const mode = normalizeAdjudicationMode(prefs.judgeAdjudicationMode);
    next.judgeAdjudicationMode = mode;
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
  const requestedMode = normalizeAdjudicationMode(data.mode);
  const nextStatus = "locked";
  const captions = data.captions || {};
  const captionScoreTotal = calculateCaptionTotal(captions);
  const rating = computeFinalRatingFromTotal(captionScoreTotal);
  let currentStatus = "draft";
  const packetSnapBeforeSubmit = await packetRef.get();
  if (!packetSnapBeforeSubmit.exists) {
    throw new HttpsError("not-found", "Packet not found.");
  }
  const packetBeforeSubmit = packetSnapBeforeSubmit.data() || {};
  const packetOwnerBeforeSubmit = packetBeforeSubmit.createdByJudgeUid === request.auth.uid;
  if (!isAdmin && !packetOwnerBeforeSubmit) {
    throw new HttpsError("permission-denied", "Not authorized.");
  }
  if (!isAdmin && packetBeforeSubmit.locked === true) {
    throw new HttpsError("failed-precondition", "Packet is locked.");
  }
  let canonicalAudio = null;
  try {
    canonicalAudio = await ensurePacketCanonicalAudio({
      packetRef,
      packet: packetBeforeSubmit,
      packetId,
      eventId: String(
          data.officialEventId ||
          packetBeforeSubmit.officialEventId ||
          packetBeforeSubmit.assignmentEventId ||
          "",
      ).trim(),
      ensembleId: String(data.ensembleId || packetBeforeSubmit.ensembleId || "").trim(),
      judgePosition: String(
          data.officialJudgePosition ||
          packetBeforeSubmit.officialJudgePosition ||
          packetBeforeSubmit.judgePosition ||
          "",
      ).trim(),
    });
  } catch (error) {
    throw new HttpsError(
        "failed-precondition",
        `Canonical stitched audio is not ready: ${error?.message || "Audio processing failed."}`,
    );
  }
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
    const packetMode = normalizeAdjudicationMode(packet.mode || requestedMode);
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
    const activeAssignmentEventId = String(assignment?.eventId || "").trim();
    const activeAssignmentJudgePosition = String(assignment?.judgePosition || "").trim();
    const effectiveOfficialEventId =
      packetMode === ADJUDICATION_MODES.official ?
        String(
            data.officialEventId ||
            packet.officialEventId ||
            activeAssignmentEventId ||
            packet.assignmentEventId ||
            "",
        ).trim() :
        "";
    const effectiveOfficialJudgePosition =
      packetMode === ADJUDICATION_MODES.official ?
        String(
            data.officialJudgePosition ||
            packet.officialJudgePosition ||
            activeAssignmentJudgePosition ||
            packet.judgePosition ||
            "",
        ).trim() :
        "";
    let audioSegments = [];
    const latestAudioUrl = String(packet.latestAudioUrl || "").trim();
    if (packetMode === ADJUDICATION_MODES.official) {
      if (!effectiveOfficialEventId || !effectiveOfficialJudgePosition) {
        throw new HttpsError(
            "failed-precondition",
            "Official adjudication requires active event assignment metadata.",
        );
      }
      if (
        !isAdmin &&
        assignment &&
        (
          String(assignment.eventId || "").trim() !== effectiveOfficialEventId ||
          String(assignment.judgePosition || "").trim() !== effectiveOfficialJudgePosition
        )
      ) {
        throw new HttpsError(
            "failed-precondition",
            "Official adjudication must match your active event assignment.",
        );
      }
      const scheduleQuery = db
          .collection(COLLECTIONS.events)
          .doc(effectiveOfficialEventId)
          .collection(COLLECTIONS.schedule)
          .where(FIELDS.schedule.schoolId, "==", nextSchoolId)
          .where(FIELDS.schedule.ensembleId, "==", nextEnsembleId)
          .limit(1);
      const scheduleSnap = await tx.get(scheduleQuery);
      if (scheduleSnap.empty) {
        throw new HttpsError(
            "failed-precondition",
            "Official adjudication must target a scheduled ensemble in the active event.",
        );
      }
      const sessionsQuery = packetRef.collection("sessions").orderBy("createdAt", "asc");
      const sessionsSnap = await tx.get(sessionsQuery);
      audioSegments = buildAudioSegmentsFromSessionSnapshots(sessionsSnap.docs);
      if (!audioSegments.length && !latestAudioUrl) {
        throw new HttpsError(
            "failed-precondition",
            "Official adjudication requires at least one uploaded audio segment.",
        );
      }
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
        (packetMode === ADJUDICATION_MODES.official ?
          "official" :
          (assignment ? "activeEventDefault" : (packet.assignmentMode || "open"))),
      [FIELDS.packets.mode]: packetMode,
      [FIELDS.packets.officialEventId]:
        packetMode === ADJUDICATION_MODES.official ?
          String(data.officialEventId || packet.officialEventId || assignment?.eventId || packet.assignmentEventId || "") :
          "",
      [FIELDS.packets.officialJudgePosition]:
        packetMode === ADJUDICATION_MODES.official ?
          String(data.officialJudgePosition || packet.officialJudgePosition || assignment?.judgePosition || packet.judgePosition || "") :
          "",
      [FIELDS.packets.officialSubmissionId]:
        "",
      [FIELDS.packets.captureStatus]: STATUSES.submitted,
      [FIELDS.packets.associationState]:
        packetMode === ADJUDICATION_MODES.official &&
        effectiveOfficialEventId &&
        effectiveOfficialJudgePosition ?
          "attached" :
          "",
      [FIELDS.packets.reviewState]:
        packetMode === ADJUDICATION_MODES.official ? "pending" : "",
      [FIELDS.packets.officialAssessmentId]: "",
      [FIELDS.packets.excludedReason]: "",
      [FIELDS.packets.transcript]: String(data.transcript || ""),
      [FIELDS.packets.transcriptFull]: String(data.transcriptFull || data.transcript || ""),
      [FIELDS.packets.captions]: captions,
      [FIELDS.packets.captionScoreTotal]: captionScoreTotal,
      [FIELDS.packets.computedFinalRatingJudge]: rating.value,
      [FIELDS.packets.computedFinalRatingLabel]: rating.label,
      canonicalAudioStatus: CANONICAL_AUDIO_STATUS.ready,
      canonicalAudioPath: canonicalAudio?.path || packet.canonicalAudioPath || "",
      canonicalAudioUrl: canonicalAudio?.url || packet.canonicalAudioUrl || "",
      canonicalAudioDurationSec: Number(
          canonicalAudio?.durationSec || packet.tapeDurationSec || 0,
      ),
      canonicalAudioError: "",
      [FIELDS.packets.tapeDurationSec]: Number(
          canonicalAudio?.durationSec || packet.tapeDurationSec || 0,
      ),
      [FIELDS.packets.submittedAt]: admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.packets.releasedAt]: null,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };
    const rawAssessmentId = buildRawAssessmentId({packetId});
    const rawAssessmentRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
    const rawAssessmentSnap = await tx.get(rawAssessmentRef);
    const currentTranscript = String(data.transcriptFull || data.transcript || "").trim();
    tx.set(packetRef, payload, {merge: true});
    if (packetMode === ADJUDICATION_MODES.official) {
      tx.set(rawAssessmentRef, {
        [FIELDS.rawAssessments.status]: STATUSES.submitted,
        [FIELDS.rawAssessments.associationState]:
          effectiveOfficialEventId && effectiveOfficialJudgePosition ? "attached" : "",
        [FIELDS.rawAssessments.reviewState]: "pending",
        [FIELDS.rawAssessments.packetId]: packetId,
        [FIELDS.rawAssessments.officialAssessmentId]: "",
        [FIELDS.rawAssessments.judgeUid]: request.auth.uid,
        [FIELDS.rawAssessments.judgeName]:
          data.createdByJudgeName || packet.createdByJudgeName || "",
        [FIELDS.rawAssessments.judgeEmail]:
          data.createdByJudgeEmail || packet.createdByJudgeEmail || "",
        [FIELDS.rawAssessments.schoolId]: nextSchoolId,
        [FIELDS.rawAssessments.eventId]: effectiveOfficialEventId,
        [FIELDS.rawAssessments.ensembleId]: nextEnsembleId,
        [FIELDS.rawAssessments.judgePosition]: effectiveOfficialJudgePosition,
        [FIELDS.rawAssessments.formType]: nextFormType,
        [FIELDS.rawAssessments.audioUrl]: canonicalAudio?.url || latestAudioUrl,
        [FIELDS.rawAssessments.audioPath]: canonicalAudio?.path || "",
        [FIELDS.rawAssessments.audioSegments]: audioSegments,
        [FIELDS.rawAssessments.audioDurationSec]: Number(
            canonicalAudio?.durationSec || packet.tapeDurationSec || 0,
        ),
        [FIELDS.rawAssessments.transcript]: currentTranscript,
        [FIELDS.rawAssessments.writtenComments]: currentTranscript,
        [FIELDS.rawAssessments.captions]: captions,
        [FIELDS.rawAssessments.captionScoreTotal]: captionScoreTotal,
        [FIELDS.rawAssessments.computedFinalRatingJudge]: rating.value,
        [FIELDS.rawAssessments.computedFinalRatingLabel]: rating.label,
        [FIELDS.rawAssessments.transcriptStatus]:
          String(packet.transcriptStatus || data.transcriptStatus || (currentTranscript ? "complete" : "idle")),
        [FIELDS.rawAssessments.submittedAt]: admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.rawAssessments.createdAt]: rawAssessmentSnap.exists ?
          (rawAssessmentSnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()) :
          admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    } else if (rawAssessmentSnap.exists) {
      tx.delete(rawAssessmentRef);
    }
  });
  await writePacketAudit(packetRef, {
    action: "submit",
    fromStatus: currentStatus,
    toStatus: nextStatus,
    actor: {uid: request.auth.uid, role: userRole || "judge"},
  });
  return {packetId, status: nextStatus, autoReleased: false};
});

exports.reassignRawAssessment = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const rawAssessmentId = buildRawAssessmentId({rawAssessmentId: data.rawAssessmentId});
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const judgePosition = String(data.judgePosition || "").trim();
  const formType = data.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
  if (!rawAssessmentId || !eventId || !ensembleId || !judgePosition) {
    throw new HttpsError(
        "invalid-argument",
        "rawAssessmentId, eventId, ensembleId, and judgePosition are required.",
    );
  }
  const db = admin.firestore();
  const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
  const rawSnap = await rawRef.get();
  if (!rawSnap.exists) {
    throw new HttpsError("not-found", "Raw assessment not found.");
  }
  const raw = rawSnap.data() || {};
  const schoolId = String(data.schoolId || raw.schoolId || "").trim();
  await rawRef.set({
    [FIELDS.rawAssessments.eventId]: eventId,
    [FIELDS.rawAssessments.ensembleId]: ensembleId,
    [FIELDS.rawAssessments.schoolId]: schoolId,
    [FIELDS.rawAssessments.judgePosition]: judgePosition,
    [FIELDS.rawAssessments.formType]: formType,
    [FIELDS.rawAssessments.associationState]: "attached",
    [FIELDS.rawAssessments.reviewState]: normalizeReviewState(raw.reviewState),
    [FIELDS.rawAssessments.officialAssessmentId]: "",
    [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  const packetId = String(raw.packetId || "").trim();
  if (packetId) {
    await db.collection(COLLECTIONS.packets).doc(packetId).set({
      [FIELDS.packets.officialEventId]: eventId,
      [FIELDS.packets.ensembleId]: ensembleId,
      [FIELDS.packets.schoolId]: schoolId,
      [FIELDS.packets.officialJudgePosition]: judgePosition,
      [FIELDS.packets.officialSubmissionId]: "",
      [FIELDS.packets.formType]: formType,
      [FIELDS.packets.associationState]: "attached",
      [FIELDS.packets.reviewState]: normalizeReviewState(raw.reviewState),
      [FIELDS.packets.officialAssessmentId]: "",
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }
  return {ok: true, rawAssessmentId};
});

exports.excludeRawAssessment = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  const profile = await assertOpsLead(request);
  const data = request.data || {};
  const rawAssessmentId = buildRawAssessmentId({rawAssessmentId: data.rawAssessmentId});
  const reason = String(data.reason || "").trim();
  if (!rawAssessmentId) {
    throw new HttpsError("invalid-argument", "rawAssessmentId is required.");
  }
  const db = admin.firestore();
  const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
  const rawSnap = await rawRef.get();
  if (!rawSnap.exists) {
    throw new HttpsError("not-found", "Raw assessment not found.");
  }
  const raw = rawSnap.data() || {};
  await rawRef.set({
    [FIELDS.rawAssessments.status]: STATUSES.excluded,
    [FIELDS.rawAssessments.reviewState]: "excluded",
    excludedReason: reason,
    [FIELDS.rawAssessments.reviewedAt]: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  const packetId = String(raw.packetId || "").trim();
  if (packetId) {
    await db.collection(COLLECTIONS.packets).doc(packetId).set({
      [FIELDS.packets.reviewState]: "excluded",
      [FIELDS.packets.captureStatus]: STATUSES.excluded,
      [FIELDS.packets.excludedReason]: reason,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    await writePacketAudit(db.collection(COLLECTIONS.packets).doc(packetId), {
      action: "exclude",
      fromStatus: raw.status || null,
      toStatus: STATUSES.excluded,
      actor: {uid: request.auth.uid, role: getEffectiveRole(profile) || "admin"},
    });
  }
  return {ok: true, rawAssessmentId};
});

exports.deleteRawAssessment = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const rawAssessmentId = buildRawAssessmentId({rawAssessmentId: data.rawAssessmentId});
  if (!rawAssessmentId) {
    throw new HttpsError("invalid-argument", "rawAssessmentId is required.");
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
  const rawSnap = await rawRef.get();
  if (!rawSnap.exists) {
    throw new HttpsError("not-found", "Raw assessment not found.");
  }

  const raw = rawSnap.data() || {};
  const officialAssessmentId = String(raw.officialAssessmentId || "").trim();
  const rawStatus = String(raw.status || "").trim();

  let officialSlotExists = false;
  if (officialAssessmentId) {
    const [officialSnap, submissionSnap] = await Promise.all([
      db.collection(COLLECTIONS.officialAssessments).doc(officialAssessmentId).get(),
      db.collection(COLLECTIONS.submissions).doc(officialAssessmentId).get(),
    ]);
    officialSlotExists = officialSnap.exists || submissionSnap.exists;
  }

  if (rawStatus === STATUSES.officialized || officialSlotExists) {
    throw new HttpsError(
        "failed-precondition",
        "Approved queue items cannot be deleted from the review queue.",
    );
  }

  const linkedOfficialSnap = await db
      .collection(COLLECTIONS.officialAssessments)
      .where(FIELDS.officialAssessments.sourceRawAssessmentId, "==", rawAssessmentId)
      .limit(1)
      .get();
  if (!linkedOfficialSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "This assessment is already officialized into a results packet.",
    );
  }

  let deletedPacket = false;
  const packetId = String(raw.packetId || "").trim();
  if (packetId) {
    const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
    const packetSnap = await packetRef.get();
    if (packetSnap.exists) {
      const packet = packetSnap.data() || {};
      const linkedPacketOfficialId = String(packet.officialAssessmentId || "").trim();
      if (linkedPacketOfficialId) {
        throw new HttpsError(
            "failed-precondition",
            "This sheet is already attached to an approved packet slot.",
        );
      }
      if (isReleasedOpenPacketStatus(packet.status)) {
        throw new HttpsError(
            "failed-precondition",
            "Released sheets cannot be deleted from the review queue.",
        );
      }
      await deleteOpenPacketDocument({
        db,
        bucket,
        packetRef,
        packet,
        packetId,
      });
      deletedPacket = true;
    }
  }

  await rawRef.delete();
  return {ok: true, rawAssessmentId, deletedPacket};
});

exports.officializeRawAssessment = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  const profile = await assertOpsLead(request);
  const data = request.data || {};
  const rawAssessmentId = buildRawAssessmentId({rawAssessmentId: data.rawAssessmentId});
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const judgePosition = String(data.judgePosition || "").trim();
  const formType = data.formType === FORM_TYPES.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
  if (!rawAssessmentId || !eventId || !ensembleId || !judgePosition) {
    throw new HttpsError(
        "invalid-argument",
        "rawAssessmentId, eventId, ensembleId, and judgePosition are required.",
    );
  }
  const db = admin.firestore();
  const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
  const rawSnap = await rawRef.get();
  if (!rawSnap.exists) {
    throw new HttpsError("not-found", "Raw assessment not found.");
  }
  const raw = rawSnap.data() || {};
  const schoolId = String(data.schoolId || raw.schoolId || "").trim();
  const officialAssessmentId = buildOfficialAssessmentId({eventId, ensembleId, judgePosition});
  const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(officialAssessmentId);
  const submissionRef = db.collection(COLLECTIONS.submissions).doc(officialAssessmentId);
  await db.runTransaction(async (tx) => {
    const officialSnap = await tx.get(officialRef);
    const officialExisting = officialSnap.exists ? (officialSnap.data() || {}) : {};
    tx.set(officialRef, {
      [FIELDS.officialAssessments.status]: STATUSES.officialized,
      [FIELDS.officialAssessments.releaseEligible]: true,
      [FIELDS.officialAssessments.sourceRawAssessmentId]: rawAssessmentId,
      [FIELDS.officialAssessments.judgeUid]: raw.judgeUid || "",
      [FIELDS.officialAssessments.judgeName]: raw.judgeName || "",
      [FIELDS.officialAssessments.judgeEmail]: raw.judgeEmail || "",
      [FIELDS.officialAssessments.schoolId]: schoolId,
      [FIELDS.officialAssessments.eventId]: eventId,
      [FIELDS.officialAssessments.ensembleId]: ensembleId,
      [FIELDS.officialAssessments.judgePosition]: judgePosition,
      [FIELDS.officialAssessments.formType]: formType,
      [FIELDS.officialAssessments.audioUrl]: raw.audioUrl || "",
      [FIELDS.officialAssessments.audioPath]: raw.audioPath || "",
      [FIELDS.officialAssessments.audioSegments]: raw.audioSegments || [],
      [FIELDS.officialAssessments.audioDurationSec]: Number(raw.audioDurationSec || 0),
      [FIELDS.officialAssessments.transcript]: raw.transcript || "",
      [FIELDS.officialAssessments.writtenComments]:
        raw.writtenComments || raw.transcript || "",
      [FIELDS.officialAssessments.captions]: raw.captions || {},
      [FIELDS.officialAssessments.captionScoreTotal]:
        Number.isFinite(Number(raw.captionScoreTotal)) ? Number(raw.captionScoreTotal) : null,
      [FIELDS.officialAssessments.computedFinalRatingJudge]:
        Number.isFinite(Number(raw.computedFinalRatingJudge)) ? Number(raw.computedFinalRatingJudge) : null,
      [FIELDS.officialAssessments.computedFinalRatingLabel]:
        String(raw.computedFinalRatingLabel || "N/A"),
      [FIELDS.officialAssessments.reviewedAt]: admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.officialAssessments.reviewedByUid]: request.auth.uid,
      [FIELDS.officialAssessments.reviewedByName]:
        profile.displayName || profile.email || request.auth.uid,
      [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.officialAssessments.createdAt]: officialSnap.exists ?
        (officialExisting.createdAt || admin.firestore.FieldValue.serverTimestamp()) :
        admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    tx.set(submissionRef, {
      [FIELDS.submissions.status]: STATUSES.submitted,
      [FIELDS.submissions.locked]: true,
      [FIELDS.submissions.judgeUid]: raw.judgeUid || "",
      [FIELDS.submissions.judgeName]: raw.judgeName || "",
      [FIELDS.submissions.judgeEmail]: raw.judgeEmail || "",
      [FIELDS.submissions.schoolId]: schoolId,
      [FIELDS.submissions.eventId]: eventId,
      [FIELDS.submissions.ensembleId]: ensembleId,
      [FIELDS.submissions.judgePosition]: judgePosition,
      [FIELDS.submissions.formType]: formType,
      [FIELDS.submissions.audioUrl]: raw.audioUrl || "",
      audioPath: raw.audioPath || "",
      audioSegments: raw.audioSegments || [],
      [FIELDS.submissions.audioDurationSec]: Number(raw.audioDurationSec || 0),
      [FIELDS.submissions.transcript]: raw.transcript || "",
      [FIELDS.submissions.captions]: raw.captions || {},
      [FIELDS.submissions.captionScoreTotal]:
        Number.isFinite(Number(raw.captionScoreTotal)) ? Number(raw.captionScoreTotal) : null,
      [FIELDS.submissions.computedFinalRatingJudge]:
        Number.isFinite(Number(raw.computedFinalRatingJudge)) ? Number(raw.computedFinalRatingJudge) : null,
      [FIELDS.submissions.computedFinalRatingLabel]: String(raw.computedFinalRatingLabel || "N/A"),
      [FIELDS.submissions.submittedAt]: raw.submittedAt || admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    tx.set(rawRef, {
      [FIELDS.rawAssessments.status]: STATUSES.officialized,
      [FIELDS.rawAssessments.associationState]: "attached",
      [FIELDS.rawAssessments.reviewState]: "approved",
      [FIELDS.rawAssessments.officialAssessmentId]: officialAssessmentId,
      [FIELDS.rawAssessments.eventId]: eventId,
      [FIELDS.rawAssessments.ensembleId]: ensembleId,
      [FIELDS.rawAssessments.schoolId]: schoolId,
      [FIELDS.rawAssessments.judgePosition]: judgePosition,
      [FIELDS.rawAssessments.formType]: formType,
      [FIELDS.rawAssessments.reviewedAt]: admin.firestore.FieldValue.serverTimestamp(),
      [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  const packetId = String(raw.packetId || "").trim();
  if (packetId) {
    const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
    await packetRef.set({
      [FIELDS.packets.officialSubmissionId]: officialAssessmentId,
      [FIELDS.packets.officialAssessmentId]: officialAssessmentId,
      [FIELDS.packets.reviewState]: "approved",
      [FIELDS.packets.associationState]: "attached",
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    await writePacketAudit(packetRef, {
      action: "officialize",
      fromStatus: raw.status || null,
      toStatus: STATUSES.officialized,
      actor: {uid: request.auth.uid, role: getEffectiveRole(profile) || "admin"},
    });
  }
  return {ok: true, rawAssessmentId, officialAssessmentId};
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
  const packetSnapBeforeRelease = await packetRef.get();
  if (!packetSnapBeforeRelease.exists) throw new HttpsError("not-found", "Packet not found.");
  try {
    await ensurePacketCanonicalAudio({
      packetRef,
      packet: packetSnapBeforeRelease.data() || {},
      packetId,
      force: false,
    });
  } catch (error) {
    throw new HttpsError(
        "failed-precondition",
        `Open packet audio is not ready for release: ${error?.message || "Audio processing failed."}`,
    );
  }
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
    if (String(packet.canonicalAudioStatus || "") !== CANONICAL_AUDIO_STATUS.ready) {
      throw new HttpsError("failed-precondition", "Open packet audio is not ready for release.");
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
  if (isReleasedOpenPacketStatus(packet.status)) {
    throw new HttpsError(
        "failed-precondition",
        "This open packet is released. Unrelease it before deleting.",
    );
  }

  const bucket = admin.storage().bucket();
  const {deletedSessionCount, deletedAuditCount} = await deleteOpenPacketDocument({
    db,
    bucket,
    packetRef,
    packet,
    packetId,
  });

  logger.info("deleteOpenPacket", {
    packetId,
    deletedSessionCount,
    deletedAuditCount,
    actorUid: request.auth.uid,
    actorRole: userRole || null,
  });

  return {ok: true, packetId};
});

exports.deleteOpenPacketSession = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const packetId = String(data.packetId || "").trim();
  const sessionId = String(data.sessionId || "").trim();
  if (!packetId || !sessionId) {
    throw new HttpsError("invalid-argument", "packetId and sessionId required.");
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
    throw new HttpsError("permission-denied", "Not authorized to delete this recording.");
  }
  if (isReleasedOpenPacketStatus(packet.status)) {
    throw new HttpsError(
        "failed-precondition",
        "This open packet is released. Unrelease it before deleting recordings.",
    );
  }
  if (packet.locked === true) {
    throw new HttpsError(
        "failed-precondition",
        "This open packet is locked. Unlock it before deleting recordings.",
    );
  }

  const sessionRef = packetRef.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Recording not found.");
  }
  const session = sessionSnap.data() || {};
  if (String(session.status || "") === "recording") {
    throw new HttpsError(
        "failed-precondition",
        "Stop recording before deleting this recording part.",
    );
  }

  const bucket = admin.storage().bucket();
  await deleteOpenPacketSessionDocument({
    bucket,
    packet,
    packetId,
    sessionRef,
    sessionId,
    session,
  });

  const remainingSessionsSnap = await packetRef.collection("sessions")
      .orderBy("startedAt", "asc")
      .get();
  await packetRef.set(buildOpenPacketSessionStatePatch({
    packet,
    sessionDocs: remainingSessionsSnap.docs,
    deletedSessionId: sessionId,
  }), {merge: true});
  await writePacketAudit(packetRef, {
    action: "delete_session",
    fromStatus: packet.status || null,
    toStatus: packet.status || null,
    actor: {uid: request.auth.uid, role: userRole || "judge"},
  });

  logger.info("deleteOpenPacketSession", {
    packetId,
    sessionId,
    remainingSessionCount: remainingSessionsSnap.size,
    actorUid: request.auth.uid,
    actorRole: userRole || null,
  });

  return {
    ok: true,
    packetId,
    sessionId,
    remainingSessionCount: remainingSessionsSnap.size,
  };
});

exports.deleteScheduledPacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  if (!eventId || !ensembleId) {
    throw new HttpsError("invalid-argument", "eventId and ensembleId required.");
  }

  const db = admin.firestore();
  const result = await deleteScheduledPacketGroup({
    db,
    eventId,
    ensembleId,
  });
  if (!result.found) {
    throw new HttpsError("not-found", "No scheduled packet submissions found.");
  }
  if (result.hasReleased) {
    throw new HttpsError(
        "failed-precondition",
        "This packet is released. Unrelease it before deleting.",
    );
  }

  logger.info("deleteScheduledPacket", {
    eventId,
    ensembleId,
    deletedSubmissions: result.deletedSubmissions,
    deletedPacketExport: result.deletedPacketExport,
    actorUid: request.auth.uid,
  });

  return {
    ok: true,
    eventId,
    ensembleId,
    deletedSubmissions: result.deletedSubmissions,
    deletedPacketExport: result.deletedPacketExport,
  };
});

exports.deleteScheduledAssessment = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const judgePosition = String(data.judgePosition || "").trim();
  if (!eventId || !ensembleId || !judgePosition) {
    throw new HttpsError("invalid-argument", "eventId, ensembleId, and judgePosition required.");
  }

  const db = admin.firestore();
  const result = await deleteScheduledAssessmentAtPosition({
    db,
    eventId,
    ensembleId,
    judgePosition,
  });
  if (!result.found) {
    throw new HttpsError("not-found", "No scheduled assessment found for that judge position.");
  }
  if (result.hasReleased) {
    throw new HttpsError(
        "failed-precondition",
        "This assessment is released. Unrelease the results packet first.",
    );
  }

  logger.info("deleteScheduledAssessment", {
    eventId,
    ensembleId,
    judgePosition,
    deletedSubmissions: result.deletedSubmissions,
    deletedOfficialAssessments: result.deletedOfficialAssessments,
    revertedRawAssessments: result.revertedRawAssessments,
    revertedPackets: result.revertedPackets,
    deletedPacketExport: result.deletedPacketExport,
    actorUid: request.auth.uid,
  });

  return {
    ok: true,
    eventId,
    ensembleId,
    judgePosition,
    deletedSubmissions: result.deletedSubmissions,
    deletedOfficialAssessments: result.deletedOfficialAssessments,
    revertedRawAssessments: result.revertedRawAssessments,
    revertedPackets: result.revertedPackets,
    deletedPacketExport: result.deletedPacketExport,
  };
});

exports.setEventAssignments = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  if (!eventId) {
    throw new HttpsError("invalid-argument", "eventId is required.");
  }
  const checks = buildAssignmentChecks(data);
  const blockers = [];
  if (!checks.allPresent) {
    blockers.push({
      code: "assignments-incomplete",
      message: "All judge positions must be assigned.",
    });
  }
  if (checks.allPresent && !checks.unique) {
    blockers.push({
      code: "assignments-not-unique",
      message: "Each judge position must use a unique judge.",
    });
  }
  if (blockers.length) {
    throw new HttpsError(
        "failed-precondition",
        "Judge assignments are invalid.",
        {blockers},
    );
  }
  const db = admin.firestore();
  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  await db
      .collection(COLLECTIONS.events)
      .doc(eventId)
      .collection(COLLECTIONS.assignments)
      .doc("positions")
      .set({
        stage1Uid: checks.stage1Uid,
        stage2Uid: checks.stage2Uid,
        stage3Uid: checks.stage3Uid,
        sightUid: checks.sightUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
      }, {merge: true});
  await eventRef.set({
    readinessState: {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, {merge: true});
  return {
    ok: true,
    eventId,
    assignments: {
      stage1Uid: checks.stage1Uid,
      stage2Uid: checks.stage2Uid,
      stage3Uid: checks.stage3Uid,
      sightUid: checks.sightUid,
    },
  };
});

exports.runEventPreflight = onCall(async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  if (!eventId) {
    throw new HttpsError("invalid-argument", "eventId is required.");
  }
  const db = admin.firestore();
  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const [eventSnap, assignmentsSnap, scheduleSnap] = await Promise.all([
    eventRef.get(),
    db.collection(COLLECTIONS.events)
        .doc(eventId)
        .collection(COLLECTIONS.assignments)
        .doc("positions")
        .get(),
    db.collection(COLLECTIONS.events)
        .doc(eventId)
        .collection(COLLECTIONS.schedule)
        .get(),
  ]);
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  const event = eventSnap.data() || {};
  const readinessState = event.readinessState && typeof event.readinessState === "object" ?
    event.readinessState :
    {};
  const readinessSteps = readinessState.steps && typeof readinessState.steps === "object" ?
    readinessState.steps :
    {};
  const existingWalkthrough =
    readinessState.walkthrough && typeof readinessState.walkthrough === "object" ?
      readinessState.walkthrough :
      {};
  const existingWalkthroughStatus = String(existingWalkthrough.status || "").trim().toLowerCase();
  const existingWalkthroughNote = String(existingWalkthrough.note || "").trim();
  const existingStartedAt = existingWalkthrough.startedAt || null;
  const existingStartedBy = String(existingWalkthrough.startedBy || "").trim();
  const existingCompletedAt = existingWalkthrough.completedAt || null;
  const existingCompletedBy = String(existingWalkthrough.completedBy || "").trim();
  const walkthroughComplete = READINESS_STEP_ORDER.every(
      (key) => String(readinessSteps?.[key]?.status || "").trim().toLowerCase() === "complete",
  );
  const isLiveEvent = normalizeEventMode(event.eventMode) === EVENT_MODES.live;
  const assignments = assignmentsSnap.exists ? (assignmentsSnap.data() || {}) : {};
  const assignmentChecks = buildAssignmentChecks(assignments);
  const assignedUids = [assignmentChecks.stage1Uid, assignmentChecks.stage2Uid, assignmentChecks.stage3Uid, assignmentChecks.sightUid]
      .filter(Boolean);
  const assignedJudgeIssues = [];
  if (assignmentChecks.allPresent) {
    const userSnaps = await Promise.all(
        assignedUids.map((uid) => db.collection(COLLECTIONS.users).doc(uid).get()),
    );
    userSnaps.forEach((snap, index) => {
      if (!snap.exists) {
        assignedJudgeIssues.push({
          uid: assignedUids[index],
          issue: "missing-user",
        });
        return;
      }
      const profile = snap.data() || {};
      if (!isJudgeProfile(profile)) {
        assignedJudgeIssues.push({
          uid: assignedUids[index],
          issue: "not-judge-role",
        });
      }
    });
  }

  const scheduleEntries = scheduleSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() || {}),
  }));
  const scheduledEnsembleIds = Array.from(
      new Set(scheduleEntries.map((entry) => String(entry.ensembleId || "").trim()).filter(Boolean)),
  );
  const entrySnaps = await Promise.all(
      scheduledEnsembleIds.map((ensembleId) =>
        db.collection(COLLECTIONS.events)
            .doc(eventId)
            .collection(COLLECTIONS.entries)
            .doc(ensembleId)
            .get(),
      ),
  );
  const missingEntryIds = [];
  const notReadyEntryIds = [];
  entrySnaps.forEach((snap, index) => {
    if (!snap.exists) {
      missingEntryIds.push(scheduledEnsembleIds[index]);
      return;
    }
    const status = String(snap.data()?.status || "").trim().toLowerCase();
    if (status !== "ready") {
      notReadyEntryIds.push(scheduledEnsembleIds[index]);
    }
  });
  const checks = [
    {
      key: "activeEvent",
      label: "Event is active",
      pass: Boolean(event.isActive),
      message: event.isActive ?
        "Active event confirmed." :
        "Set this event as active before live operations.",
    },
    {
      key: "assignmentsComplete",
      label: "All judge positions assigned",
      pass: assignmentChecks.allPresent,
      message: assignmentChecks.allPresent ?
        "Stage 1/2/3 and Sight assignments are set." :
        "Assign Stage 1/2/3 and Sight judges.",
    },
    {
      key: "assignmentsUnique",
      label: "Judge assignments are unique",
      pass: assignmentChecks.allPresent ? assignmentChecks.unique : true,
      message: assignmentChecks.allPresent ?
        (assignmentChecks.unique ?
          "Each judge position has a unique UID." :
          "One or more judge positions share the same user.") :
        "Uniqueness is checked after all positions are assigned.",
    },
    {
      key: "assignedUsersValid",
      label: "Assigned users exist and are judge-role",
      pass: assignmentChecks.allPresent ? assignedJudgeIssues.length === 0 : true,
      message: assignmentChecks.allPresent ?
        (assignedJudgeIssues.length === 0 ?
          "All assigned users are valid judge accounts." :
          `${assignedJudgeIssues.length} assigned user(s) are missing or not judge-role.`) :
        "User-role validation runs after all positions are assigned.",
    },
    {
      key: "schedulePresent",
      label: "Schedule has entries",
      pass: scheduleEntries.length > 0,
      message: scheduleEntries.length > 0 ?
        `${scheduleEntries.length} schedule row(s) loaded.` :
        "Create schedule entries before event operations.",
    },
    {
      key: "entriesPresentForScheduled",
      label: "Scheduled ensembles have entry docs",
      pass: scheduleEntries.length === 0 ? true : missingEntryIds.length === 0,
      message: scheduleEntries.length === 0 ?
        "Entry coverage is evaluated once schedules exist." :
        (missingEntryIds.length === 0 ?
          "All scheduled ensembles have an event entry document." :
          `${missingEntryIds.length} scheduled ensemble(s) are missing entry documents.`),
    },
    {
      key: "directorEntriesReady",
      label: "Scheduled entries are marked ready",
      pass: scheduleEntries.length === 0 ?
        true :
        (missingEntryIds.length === 0 && notReadyEntryIds.length === 0),
      message: scheduleEntries.length === 0 ?
        "Director readiness is evaluated once schedules exist." :
        (missingEntryIds.length > 0 ?
          "Resolve missing entry docs before readiness can be confirmed." :
          (notReadyEntryIds.length === 0 ?
            "All scheduled entries are ready." :
            `${notReadyEntryIds.length} scheduled entry(ies) are still draft.`)),
    },
    {
      key: "walkthroughComplete",
      label: "Readiness walkthrough is complete",
      pass: isLiveEvent ? walkthroughComplete : true,
      message: isLiveEvent ?
        (walkthroughComplete ?
          "All walkthrough checkpoints are complete." :
          "Complete all walkthrough checkpoints in Admin > Readiness.") :
        "Walkthrough completion is not required for rehearsal events.",
    },
  ];
  const blockers = checks
      .filter((check) => !check.pass)
      .map((check) => ({code: check.key, message: check.message}));
  const preflight = {
    pass: blockers.length === 0,
    checks,
    blockers,
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
    ranBy: request.auth.uid,
  };
  const hasWalkthroughActivity =
    Boolean(existingStartedAt) ||
    Boolean(existingStartedBy) ||
    READINESS_STEP_ORDER.some(
        (key) => {
          const step = readinessSteps?.[key] || {};
          const status = String(step.status || "").trim().toLowerCase();
          return (
            status === "complete" ||
            Boolean(step.updatedAt) ||
            Boolean(String(step.updatedBy || "").trim()) ||
            Boolean(String(step.note || "").trim())
          );
        },
    );
  const nextWalkthroughStatus = walkthroughComplete ?
    "complete" :
    (hasWalkthroughActivity ? "in-progress" : "not-started");
  const defaultWalkthroughNote = walkthroughComplete ?
    "Walkthrough complete" :
    (hasWalkthroughActivity ? "Walkthrough in progress" : "Walkthrough not started");
  const nextWalkthroughNote = existingWalkthroughNote && existingWalkthroughStatus === nextWalkthroughStatus ?
    existingWalkthroughNote :
    defaultWalkthroughNote;
  const nextStartedAt = hasWalkthroughActivity ?
    (existingStartedAt || admin.firestore.FieldValue.serverTimestamp()) :
    null;
  const nextStartedBy = hasWalkthroughActivity ?
    (existingStartedBy || request.auth.uid) :
    "";
  await eventRef.set({
    eventMode: normalizeEventMode(event.eventMode),
    readinessState: {
      preflight,
      walkthrough: {
        status: nextWalkthroughStatus,
        note: nextWalkthroughNote,
        startedAt: nextStartedAt,
        startedBy: nextStartedBy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
        completedAt: walkthroughComplete ?
          (existingCompletedAt || admin.firestore.FieldValue.serverTimestamp()) :
          null,
        completedBy: walkthroughComplete ?
          (existingCompletedBy || request.auth.uid) :
          "",
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, {merge: true});
  return {
    ok: true,
    eventId,
    pass: blockers.length === 0,
    checks,
    blockers,
  };
});

exports.markReadinessStep = onCall(async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const stepKey = String(data.stepKey || "").trim();
  const note = String(data.note || "").trim();
  const rawStatus = String(data.status || "").trim().toLowerCase();
  if (rawStatus !== "complete" && rawStatus !== "incomplete") {
    throw new HttpsError("invalid-argument", "status must be complete or incomplete.");
  }
  if (note.length > MAX_READINESS_NOTE_LENGTH) {
    throw new HttpsError(
        "invalid-argument",
        `note must be <= ${MAX_READINESS_NOTE_LENGTH} characters.`,
    );
  }
  const status = rawStatus;
  if (!eventId || !stepKey) {
    throw new HttpsError("invalid-argument", "eventId and stepKey required.");
  }
  if (!READINESS_STEP_KEYS.has(stepKey)) {
    throw new HttpsError("invalid-argument", "Unsupported readiness step.");
  }
  const db = admin.firestore();
  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  const readinessState = eventSnap.data()?.readinessState || {};
  const currentSteps = readinessState.steps && typeof readinessState.steps === "object" ?
    readinessState.steps :
    {};
  const currentWalkthrough =
    readinessState.walkthrough && typeof readinessState.walkthrough === "object" ?
      readinessState.walkthrough :
      {};
  const nextStatuses = {};
  READINESS_STEP_ORDER.forEach((key) => {
    const existingStatus = String(currentSteps?.[key]?.status || "").trim().toLowerCase();
    nextStatuses[key] = key === stepKey ? status : (existingStatus === "complete" ? "complete" : "incomplete");
  });
  const allComplete = READINESS_STEP_ORDER.every((key) => nextStatuses[key] === "complete");
  const persistedStartedAt = currentWalkthrough.startedAt || null;
  const persistedStartedBy = String(currentWalkthrough.startedBy || "").trim();
  await eventRef.set({
    readinessState: {
      steps: {
        [stepKey]: {
          status,
          note,
          source: "ui",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: request.auth.uid,
        },
      },
      walkthrough: {
        status: allComplete ? "complete" : "in-progress",
        note: note || (allComplete ? "Walkthrough complete" : "Walkthrough step updated"),
        startedAt: persistedStartedAt || admin.firestore.FieldValue.serverTimestamp(),
        startedBy: persistedStartedBy || request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
        completedAt: allComplete ? admin.firestore.FieldValue.serverTimestamp() : null,
        completedBy: allComplete ? request.auth.uid : "",
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, {merge: true});
  return {ok: true, eventId, stepKey, status};
});

exports.setReadinessWalkthrough = onCall(async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const rawStatus = String(data.status || "").trim().toLowerCase();
  if (rawStatus !== "incomplete") {
    throw new HttpsError("invalid-argument", "setReadinessWalkthrough only supports incomplete resets.");
  }
  const status = rawStatus;
  const note = String(data.note || "").trim();
  if (note.length > MAX_READINESS_NOTE_LENGTH) {
    throw new HttpsError(
        "invalid-argument",
        `note must be <= ${MAX_READINESS_NOTE_LENGTH} characters.`,
    );
  }
  if (!eventId) {
    throw new HttpsError("invalid-argument", "eventId is required.");
  }
  const db = admin.firestore();
  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  const stepPatch = {};
  READINESS_STEP_ORDER.forEach((stepKey) => {
    stepPatch[stepKey] = {
      status,
      note,
      source: "ui",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    };
  });
  const normalizedWalkthroughStatus = "in-progress";
  await eventRef.set({
    readinessState: {
      steps: stepPatch,
      walkthrough: {
        status: normalizedWalkthroughStatus,
        note,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        startedBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
        completedAt: null,
        completedBy: "",
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, {merge: true});
  return {
    ok: true,
    eventId,
    status,
    steps: READINESS_STEP_ORDER,
  };
});

function isTestArtifactText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /\btest\b/,
    /\bsmoke\b/,
    /\be2e\b/,
    /\brelease e2e\b/,
    /\bdemo\b/,
    /\bsandbox\b/,
    /\bqa\b/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function hasExplicitTestArtifactFlag(data = {}) {
  if (!data || typeof data !== "object") return false;
  if (data.isTestArtifact === true || data.testArtifact === true) return true;
  const tags = Array.isArray(data.tags) ? data.tags : [];
  return tags.some((tag) => {
    const normalized = String(tag || "").trim().toLowerCase();
    return normalized === "test-artifact" || normalized === "test";
  });
}

function isLikelyTestArtifact({
  id,
  name,
} = {}) {
  return isTestArtifactText(id) || isTestArtifactText(name);
}

exports.cleanupTestArtifacts = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertAdmin(request);
  assertDestructiveAdminToolsAllowed("cleanupTestArtifacts");
  const data = request.data || {};
  const dryRun = data.dryRun !== false;
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const summary = {
    ok: true,
    dryRun,
    strictMode: true,
    includeActiveEvent: data.includeActiveEvent === true,
    eventCandidates: [],
    schoolCandidates: [],
    suggestedEventMatches: [],
    suggestedSchoolMatches: [],
    activeEventSkipped: [],
    packetCandidates: 0,
    submissionCandidates: 0,
    officialAssessmentCandidates: 0,
    audioResultCandidates: 0,
    packetExportCandidates: 0,
    deletedEvents: 0,
    deletedSchools: 0,
    deletedOpenPackets: 0,
    deletedOpenPacketSessions: 0,
    deletedOpenPacketAuditDocs: 0,
    deletedSubmissions: 0,
    deletedOfficialAssessments: 0,
    deletedAudioResults: 0,
    deletedPacketExports: 0,
    deletedScheduleRows: 0,
    deletedEntryRows: 0,
    usersUnassignedFromDeletedSchools: 0,
  };

  const [eventsSnap, schoolsSnap] = await Promise.all([
    db.collection(COLLECTIONS.events).get(),
    db.collection(COLLECTIONS.schools).get(),
  ]);

  const includeActiveEvent = summary.includeActiveEvent;
  const activeEventIds = new Set(
      eventsSnap.docs
          .filter((docSnap) => docSnap.data()?.[FIELDS.events.isActive] === true)
          .map((docSnap) => docSnap.id),
  );

  const suggestedEventDocs = eventsSnap.docs.filter((docSnap) => {
    const event = docSnap.data() || {};
    return isLikelyTestArtifact({
      id: docSnap.id,
      name: event.name,
    });
  });
  const suggestedSchoolDocs = schoolsSnap.docs.filter((docSnap) => {
    const school = docSnap.data() || {};
    return isLikelyTestArtifact({
      id: docSnap.id,
      name: school.name,
    });
  });

  const eventDocs = eventsSnap.docs.filter((docSnap) => {
    const event = docSnap.data() || {};
    if (!hasExplicitTestArtifactFlag(event)) return false;
    if (!includeActiveEvent && activeEventIds.has(docSnap.id)) {
      summary.activeEventSkipped.push(docSnap.id);
      return false;
    }
    return true;
  });
  const schoolDocs = schoolsSnap.docs.filter((docSnap) => {
    const school = docSnap.data() || {};
    return hasExplicitTestArtifactFlag(school);
  });

  summary.eventCandidates = eventDocs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.data()?.name || ""),
  }));
  summary.schoolCandidates = schoolDocs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.data()?.name || ""),
  }));
  summary.suggestedEventMatches = suggestedEventDocs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.data()?.name || ""),
  }));
  summary.suggestedSchoolMatches = suggestedSchoolDocs.map((docSnap) => ({
    id: docSnap.id,
    name: String(docSnap.data()?.name || ""),
  }));

  const eventIds = new Set(eventDocs.map((docSnap) => docSnap.id));
  const schoolIds = new Set(schoolDocs.map((docSnap) => docSnap.id));
  if (!eventIds.size && !schoolIds.size) {
    return summary;
  }

  const packetDocsById = new Map();
  const addPacketDocs = async (queryRef) => {
    const snap = await queryRef.get();
    snap.docs.forEach((docSnap) => packetDocsById.set(docSnap.id, docSnap));
  };
  for (const eventId of eventIds) {
    await addPacketDocs(
        db.collection(COLLECTIONS.packets).where(FIELDS.packets.assignmentEventId, "==", eventId),
    );
    await addPacketDocs(
        db.collection(COLLECTIONS.packets).where(FIELDS.packets.officialEventId, "==", eventId),
    );
    await addPacketDocs(
        db.collection(COLLECTIONS.packets).where(FIELDS.packets.eventId, "==", eventId),
    );
  }
  for (const schoolId of schoolIds) {
    await addPacketDocs(
        db.collection(COLLECTIONS.packets).where(FIELDS.packets.schoolId, "==", schoolId),
    );
  }
  summary.packetCandidates = packetDocsById.size;

  const submissionsById = new Map();
  const addSubmissions = async (queryRef) => {
    const snap = await queryRef.get();
    snap.docs.forEach((docSnap) => submissionsById.set(docSnap.id, docSnap));
  };
  for (const eventId of eventIds) {
    await addSubmissions(
        db.collection(COLLECTIONS.submissions).where(FIELDS.submissions.eventId, "==", eventId),
    );
  }
  for (const schoolId of schoolIds) {
    await addSubmissions(
        db.collection(COLLECTIONS.submissions).where(FIELDS.submissions.schoolId, "==", schoolId),
    );
  }
  summary.submissionCandidates = submissionsById.size;

  const officialAssessmentsById = new Map();
  const addOfficialAssessments = async (queryRef) => {
    const snap = await queryRef.get();
    snap.docs.forEach((docSnap) => officialAssessmentsById.set(docSnap.id, docSnap));
  };
  for (const eventId of eventIds) {
    await addOfficialAssessments(
        db.collection(COLLECTIONS.officialAssessments).where(FIELDS.officialAssessments.eventId, "==", eventId),
    );
  }
  for (const schoolId of schoolIds) {
    await addOfficialAssessments(
        db.collection(COLLECTIONS.officialAssessments).where(FIELDS.officialAssessments.schoolId, "==", schoolId),
    );
  }
  summary.officialAssessmentCandidates = officialAssessmentsById.size;

  const audioResultsById = new Map();
  const addAudioResults = async (queryRef) => {
    const snap = await queryRef.get();
    snap.docs.forEach((docSnap) => audioResultsById.set(docSnap.id, docSnap));
  };
  for (const eventId of eventIds) {
    await addAudioResults(
        db.collection(COLLECTIONS.audioResults).where(FIELDS.audioResults.eventId, "==", eventId),
    );
  }
  for (const schoolId of schoolIds) {
    await addAudioResults(
        db.collection(COLLECTIONS.audioResults).where(FIELDS.audioResults.schoolId, "==", schoolId),
    );
  }
  summary.audioResultCandidates = audioResultsById.size;

  const packetExportsById = new Map();
  const addPacketExports = async (queryRef) => {
    const snap = await queryRef.get();
    snap.docs.forEach((docSnap) => packetExportsById.set(docSnap.id, docSnap));
  };
  for (const eventId of eventIds) {
    await addPacketExports(
        db.collection(COLLECTIONS.packetExports).where(FIELDS.packetExports.eventId, "==", eventId),
    );
  }
  for (const schoolId of schoolIds) {
    await addPacketExports(
        db.collection(COLLECTIONS.packetExports).where(FIELDS.packetExports.schoolId, "==", schoolId),
    );
  }
  summary.packetExportCandidates = packetExportsById.size;

  if (dryRun) {
    return summary;
  }

  for (const packetDoc of packetDocsById.values()) {
    const packet = packetDoc.data() || {};
    const deletionResult = await deleteOpenPacketDocument({
      db,
      bucket,
      packetRef: packetDoc.ref,
      packet,
      packetId: packetDoc.id,
    });
    summary.deletedOpenPackets += 1;
    summary.deletedOpenPacketSessions += deletionResult.deletedSessionCount;
    summary.deletedOpenPacketAuditDocs += deletionResult.deletedAuditCount;
  }

  summary.deletedSubmissions = await deleteDocsInBatches(db, Array.from(submissionsById.values()));
  summary.deletedOfficialAssessments = await deleteDocsInBatches(db, Array.from(officialAssessmentsById.values()));
  summary.deletedAudioResults = await deleteDocsInBatches(db, Array.from(audioResultsById.values()));
  summary.deletedPacketExports = await deleteDocsInBatches(db, Array.from(packetExportsById.values()));

  const remainingEventDocs = eventsSnap.docs.filter((docSnap) => !eventIds.has(docSnap.id));
  for (const eventDoc of remainingEventDocs) {
    const eventId = eventDoc.id;
    for (const schoolId of schoolIds) {
      const [scheduleSnap, entriesSnap] = await Promise.all([
        db.collection(COLLECTIONS.events)
            .doc(eventId)
            .collection(COLLECTIONS.schedule)
            .where(FIELDS.schedule.schoolId, "==", schoolId)
            .get(),
        db.collection(COLLECTIONS.events)
            .doc(eventId)
            .collection(COLLECTIONS.entries)
            .where(FIELDS.entries.schoolId, "==", schoolId)
            .get(),
      ]);
      summary.deletedScheduleRows += await deleteDocsInBatches(db, scheduleSnap.docs);
      summary.deletedEntryRows += await deleteDocsInBatches(db, entriesSnap.docs);
    }
  }

  for (const schoolId of schoolIds) {
    const usersSnap = await db
        .collection(COLLECTIONS.users)
        .where(FIELDS.users.schoolId, "==", schoolId)
        .get();
    if (!usersSnap.empty) {
      const batch = db.batch();
      usersSnap.docs.forEach((docSnap) => {
        batch.set(docSnap.ref, {
          [FIELDS.users.schoolId]: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
      });
      await batch.commit();
      summary.usersUnassignedFromDeletedSchools += usersSnap.size;
    }
  }

  for (const eventDoc of eventDocs) {
    if (typeof db.recursiveDelete === "function") {
      await db.recursiveDelete(eventDoc.ref);
    } else {
      await eventDoc.ref.delete();
    }
    summary.deletedEvents += 1;
  }

  for (const schoolDoc of schoolDocs) {
    if (typeof db.recursiveDelete === "function") {
      await db.recursiveDelete(schoolDoc.ref);
    } else {
      await schoolDoc.ref.delete();
    }
    summary.deletedSchools += 1;
  }

  return summary;
});

exports.cleanupRehearsalArtifacts = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  if (!eventId) {
    throw new HttpsError("invalid-argument", "eventId is required.");
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const eventRef = db.collection(COLLECTIONS.events).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  const event = eventSnap.data() || {};
  if (normalizeEventMode(event.eventMode) !== EVENT_MODES.rehearsal) {
    throw new HttpsError(
        "failed-precondition",
        "Cleanup is limited to rehearsal events.",
    );
  }

  let deletedOpenPackets = 0;
  let skippedReleasedOpenPackets = 0;
  let deletedOpenPacketSessions = 0;
  let deletedOpenPacketAuditDocs = 0;
  let deletedScheduledPackets = 0;
  let skippedReleasedScheduledPackets = 0;
  let deletedSubmissions = 0;
  let deletedOfficialAssessments = 0;
  let deletedPacketExports = 0;

  const [assignmentPacketsSnap, officialPacketsSnap] = await Promise.all([
    db.collection(COLLECTIONS.packets)
        .where(FIELDS.packets.assignmentEventId, "==", eventId)
        .get(),
    db.collection(COLLECTIONS.packets)
        .where(FIELDS.packets.officialEventId, "==", eventId)
        .get(),
  ]);
  const openPacketDocs = new Map();
  assignmentPacketsSnap.docs.forEach((docSnap) => openPacketDocs.set(docSnap.id, docSnap));
  officialPacketsSnap.docs.forEach((docSnap) => openPacketDocs.set(docSnap.id, docSnap));
  for (const packetDoc of openPacketDocs.values()) {
    const packet = packetDoc.data() || {};
    if (isReleasedOpenPacketStatus(packet.status)) {
      skippedReleasedOpenPackets += 1;
      continue;
    }
    const deletionResult = await deleteOpenPacketDocument({
      db,
      bucket,
      packetRef: packetDoc.ref,
      packet,
      packetId: packetDoc.id,
    });
    deletedOpenPackets += 1;
    deletedOpenPacketSessions += deletionResult.deletedSessionCount;
    deletedOpenPacketAuditDocs += deletionResult.deletedAuditCount;
  }

  const [submissionsSnap, officialAssessmentsSnap] = await Promise.all([
    db
        .collection(COLLECTIONS.submissions)
        .where(FIELDS.submissions.eventId, "==", eventId)
        .get(),
    db
        .collection(COLLECTIONS.officialAssessments)
        .where(FIELDS.officialAssessments.eventId, "==", eventId)
        .get(),
  ]);
  const scheduledGroups = new Map();
  const registerScheduledGroup = (item = {}) => {
    const ensembleId = String(item.ensembleId || "").trim();
    if (!ensembleId) return;
    if (!scheduledGroups.has(ensembleId)) {
      scheduledGroups.set(ensembleId, {ensembleId, hasReleased: false});
    }
    if (item.status === STATUSES.released) {
      scheduledGroups.get(ensembleId).hasReleased = true;
    }
  };
  submissionsSnap.forEach((docSnap) => registerScheduledGroup(docSnap.data() || {}));
  officialAssessmentsSnap.forEach((docSnap) => registerScheduledGroup(docSnap.data() || {}));
  for (const group of scheduledGroups.values()) {
    if (group.hasReleased) {
      skippedReleasedScheduledPackets += 1;
      continue;
    }
    const result = await deleteScheduledPacketGroup({
      db,
      eventId,
      ensembleId: group.ensembleId,
    });
    if (!result.found || result.hasReleased) {
      if (result.hasReleased) skippedReleasedScheduledPackets += 1;
      continue;
    }
    if (result.deletedSubmissions > 0 || result.deletedOfficialAssessments > 0) {
      deletedScheduledPackets += 1;
      deletedSubmissions += result.deletedSubmissions;
      deletedOfficialAssessments += result.deletedOfficialAssessments;
      deletedPacketExports += result.deletedPacketExport;
    }
  }

  await eventRef.set({
    readinessState: {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, {merge: true});

  return {
    ok: true,
    eventId,
    deletedOpenPackets,
    skippedReleasedOpenPackets,
    deletedOpenPacketSessions,
    deletedOpenPacketAuditDocs,
    deletedScheduledPackets,
    skippedReleasedScheduledPackets,
    deletedSubmissions,
    deletedOfficialAssessments,
    deletedPacketExports,
  };
});

exports.deleteAllUnreleasedPackets = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertAdmin(request);
  assertDestructiveAdminToolsAllowed("deleteAllUnreleasedPackets");
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  let deletedOpenPackets = 0;
  let skippedReleasedOpenPackets = 0;
  let deletedOpenPacketSessions = 0;
  let deletedOpenPacketAuditDocs = 0;
  let deletedScheduledPackets = 0;
  let skippedReleasedScheduledPackets = 0;
  let deletedSubmissions = 0;
  let deletedOfficialAssessments = 0;
  let deletedPacketExports = 0;

  const openPacketsSnap = await db.collection(COLLECTIONS.packets).get();
  for (const packetDoc of openPacketsSnap.docs) {
    const packet = packetDoc.data() || {};
    if (isReleasedOpenPacketStatus(packet.status)) {
      skippedReleasedOpenPackets += 1;
      continue;
    }
    const deletionResult = await deleteOpenPacketDocument({
      db,
      bucket,
      packetRef: packetDoc.ref,
      packet,
      packetId: packetDoc.id,
    });
    deletedOpenPackets += 1;
    deletedOpenPacketSessions += deletionResult.deletedSessionCount;
    deletedOpenPacketAuditDocs += deletionResult.deletedAuditCount;
  }

  const [submissionsSnap, officialAssessmentsSnap] = await Promise.all([
    db.collection(COLLECTIONS.submissions).get(),
    db.collection(COLLECTIONS.officialAssessments).get(),
  ]);
  const scheduledGroups = new Map();
  const registerScheduledGroup = (item = {}) => {
    const eventId = String(item.eventId || "").trim();
    const ensembleId = String(item.ensembleId || "").trim();
    if (!eventId || !ensembleId) return;
    const key = `${eventId}__${ensembleId}`;
    if (!scheduledGroups.has(key)) {
      scheduledGroups.set(key, {eventId, ensembleId, hasReleased: false});
    }
    const group = scheduledGroups.get(key);
    if (item.status === STATUSES.released) {
      group.hasReleased = true;
    }
  };
  submissionsSnap.forEach((docSnap) => registerScheduledGroup(docSnap.data() || {}));
  officialAssessmentsSnap.forEach((docSnap) => registerScheduledGroup(docSnap.data() || {}));

  for (const group of scheduledGroups.values()) {
    if (group.hasReleased) {
      skippedReleasedScheduledPackets += 1;
      continue;
    }
    const result = await deleteScheduledPacketGroup({
      db,
      eventId: group.eventId,
      ensembleId: group.ensembleId,
    });
    if (!result.found || result.hasReleased) {
      if (result.hasReleased) skippedReleasedScheduledPackets += 1;
      continue;
    }
    if (result.deletedSubmissions > 0 || result.deletedOfficialAssessments > 0) {
      deletedScheduledPackets += 1;
      deletedSubmissions += result.deletedSubmissions;
      deletedOfficialAssessments += result.deletedOfficialAssessments;
      deletedPacketExports += result.deletedPacketExport;
    }
  }

  logger.info("deleteAllUnreleasedPackets", {
    actorUid: request.auth.uid,
    deletedOpenPackets,
    skippedReleasedOpenPackets,
    deletedOpenPacketSessions,
    deletedOpenPacketAuditDocs,
    deletedScheduledPackets,
    skippedReleasedScheduledPackets,
    deletedSubmissions,
    deletedOfficialAssessments,
    deletedPacketExports,
  });

  return {
    ok: true,
    deletedOpenPackets,
    skippedReleasedOpenPackets,
    deletedOpenPacketSessions,
    deletedOpenPacketAuditDocs,
    deletedScheduledPackets,
    skippedReleasedScheduledPackets,
    deletedSubmissions,
    deletedOfficialAssessments,
    deletedPacketExports,
  };
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
  const officialRefs = positions.map((position) => {
    const assessmentId = `${eventId}_${ensembleId}_${position}`;
    return db.collection(COLLECTIONS.officialAssessments).doc(assessmentId);
  });
  let schoolId = "";
  await db.runTransaction(async (tx) => {
    const submissionDocs = await Promise.all(submissionRefs.map((ref) => tx.get(ref)));
    const officialDocs = await Promise.all(officialRefs.map((ref) => tx.get(ref)));
    const assessments = buildCanonicalPacketAssessments({
      positions,
      officialDocs,
      submissionDocs,
    });
    if (!assessments.every((item) => isSubmissionReady(item.assessment))) {
      const blockers = assessments.map((item) => ({
        position: item.position,
        label: item.label,
        ready: isSubmissionReady(item.assessment),
      })).filter((item) => !item.ready);
      throw new HttpsError(
          "failed-precondition",
          "All required submissions must be complete, locked, and submitted.",
          {blockers},
      );
    }

    if (grade === "I") {
      const stageScores = [
        assessments[0]?.assessment?.computedFinalRatingJudge,
        assessments[1]?.assessment?.computedFinalRatingJudge,
        assessments[2]?.assessment?.computedFinalRatingJudge,
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
    schoolId = String(
        assessments.find((item) => item.assessment?.schoolId)?.assessment?.schoolId || "",
    );
    assessments.forEach((item, index) => {
      const canonical = item.assessment || {};
      tx.set(submissionRefs[index], {
        [FIELDS.submissions.status]: STATUSES.released,
        [FIELDS.submissions.locked]: true,
        [FIELDS.submissions.judgeUid]: canonical.judgeUid || "",
        [FIELDS.submissions.judgeName]: canonical.judgeName || "",
        [FIELDS.submissions.judgeEmail]: canonical.judgeEmail || "",
        [FIELDS.submissions.schoolId]: canonical.schoolId || "",
        [FIELDS.submissions.eventId]: canonical.eventId || eventId,
        [FIELDS.submissions.ensembleId]: canonical.ensembleId || ensembleId,
        [FIELDS.submissions.judgePosition]: canonical.judgePosition || item.position,
        [FIELDS.submissions.formType]: canonical.formType || (
          item.position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage
        ),
        [FIELDS.submissions.audioUrl]:
          canonical.audioUrl ||
          canonical.canonicalAudioUrl ||
          "",
        audioPath:
          canonical.audioPath ||
          canonical.canonicalAudioPath ||
          "",
        [FIELDS.submissions.audioSegments]: canonical.audioSegments || [],
        [FIELDS.submissions.audioDurationSec]: Number(
            canonical.audioDurationSec ||
            canonical.canonicalAudioDurationSec ||
            0,
        ),
        [FIELDS.submissions.transcript]: canonical.transcript || "",
        [FIELDS.submissions.captions]: canonical.captions || {},
        [FIELDS.submissions.captionScoreTotal]:
          Number.isFinite(Number(canonical.captionScoreTotal)) ? Number(canonical.captionScoreTotal) : null,
        [FIELDS.submissions.computedFinalRatingJudge]:
          Number.isFinite(Number(canonical.computedFinalRatingJudge)) ?
              Number(canonical.computedFinalRatingJudge) :
              null,
        [FIELDS.submissions.computedFinalRatingLabel]:
          String(canonical.computedFinalRatingLabel || "N/A"),
        submittedAt:
          canonical.submittedAt ||
          admin.firestore.FieldValue.serverTimestamp(),
        releasedAt: admin.firestore.FieldValue.serverTimestamp(),
        releasedBy: request.auth.uid,
        [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    });
    assessments.forEach((item, index) => {
      const canonical = item.assessment || {};
      const officialExisting = officialDocs[index]?.exists ? (officialDocs[index].data() || {}) : {};
      tx.set(officialRefs[index], {
        [FIELDS.officialAssessments.status]: STATUSES.released,
        [FIELDS.officialAssessments.releaseEligible]: canonical.releaseEligible !== false,
        [FIELDS.officialAssessments.sourceRawAssessmentId]:
          canonical.sourceRawAssessmentId || officialExisting.sourceRawAssessmentId || "",
        [FIELDS.officialAssessments.judgeUid]: canonical.judgeUid || "",
        [FIELDS.officialAssessments.judgeName]: canonical.judgeName || "",
        [FIELDS.officialAssessments.judgeEmail]: canonical.judgeEmail || "",
        [FIELDS.officialAssessments.schoolId]: canonical.schoolId || "",
        [FIELDS.officialAssessments.eventId]: canonical.eventId || eventId,
        [FIELDS.officialAssessments.ensembleId]: canonical.ensembleId || ensembleId,
        [FIELDS.officialAssessments.judgePosition]: canonical.judgePosition || item.position,
        [FIELDS.officialAssessments.formType]: canonical.formType || (
          item.position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage
        ),
        [FIELDS.officialAssessments.audioUrl]:
          canonical.audioUrl ||
          canonical.canonicalAudioUrl ||
          "",
        [FIELDS.officialAssessments.audioPath]:
          canonical.audioPath ||
          canonical.canonicalAudioPath ||
          "",
        [FIELDS.officialAssessments.audioSegments]: canonical.audioSegments || [],
        [FIELDS.officialAssessments.audioDurationSec]: Number(
            canonical.audioDurationSec ||
            canonical.canonicalAudioDurationSec ||
            0,
        ),
        [FIELDS.officialAssessments.transcript]: canonical.transcript || "",
        [FIELDS.officialAssessments.writtenComments]:
          canonical.writtenComments || canonical.transcript || "",
        [FIELDS.officialAssessments.captions]: canonical.captions || {},
        [FIELDS.officialAssessments.captionScoreTotal]:
          Number.isFinite(Number(canonical.captionScoreTotal)) ? Number(canonical.captionScoreTotal) : null,
        [FIELDS.officialAssessments.computedFinalRatingJudge]:
          Number.isFinite(Number(canonical.computedFinalRatingJudge)) ?
              Number(canonical.computedFinalRatingJudge) :
              null,
        [FIELDS.officialAssessments.computedFinalRatingLabel]:
          String(canonical.computedFinalRatingLabel || "N/A"),
        [FIELDS.officialAssessments.releasedAt]: admin.firestore.FieldValue.serverTimestamp(),
        releasedBy: request.auth.uid,
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.officialAssessments.createdAt]:
          officialExisting.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
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
  const officialRefs = positions.map((position) => {
    const assessmentId = `${eventId}_${ensembleId}_${position}`;
    return db.collection(COLLECTIONS.officialAssessments).doc(assessmentId);
  });
  await db.runTransaction(async (tx) => {
    const submissionDocs = await Promise.all(submissionRefs.map((ref) => tx.get(ref)));
    const officialDocs = await Promise.all(officialRefs.map((ref) => tx.get(ref)));
    const assessments = buildCanonicalPacketAssessments({
      positions,
      officialDocs,
      submissionDocs,
    });
    if (
      !assessments.every((item) => item.assessment?.status === STATUSES.released)
    ) {
      const blockers = assessments.map((item) => ({
        position: item.position,
        label: item.label,
        status: String(item.assessment?.status || "missing"),
      })).filter((item) => item.status !== STATUSES.released);
      throw new HttpsError(
          "failed-precondition",
          "All required submissions must be released to unrelease.",
          {blockers},
      );
    }
    assessments.forEach((item, index) => {
      const canonical = item.assessment || {};
      tx.set(submissionRefs[index], {
        [FIELDS.submissions.status]: STATUSES.submitted,
        [FIELDS.submissions.locked]: true,
        [FIELDS.submissions.judgeUid]: canonical.judgeUid || "",
        [FIELDS.submissions.judgeName]: canonical.judgeName || "",
        [FIELDS.submissions.judgeEmail]: canonical.judgeEmail || "",
        [FIELDS.submissions.schoolId]: canonical.schoolId || "",
        [FIELDS.submissions.eventId]: canonical.eventId || eventId,
        [FIELDS.submissions.ensembleId]: canonical.ensembleId || ensembleId,
        [FIELDS.submissions.judgePosition]: canonical.judgePosition || item.position,
        [FIELDS.submissions.formType]: canonical.formType || (
          item.position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage
        ),
        [FIELDS.submissions.audioUrl]:
          canonical.audioUrl ||
          canonical.canonicalAudioUrl ||
          "",
        audioPath:
          canonical.audioPath ||
          canonical.canonicalAudioPath ||
          "",
        [FIELDS.submissions.audioSegments]: canonical.audioSegments || [],
        [FIELDS.submissions.audioDurationSec]: Number(
            canonical.audioDurationSec ||
            canonical.canonicalAudioDurationSec ||
            0,
        ),
        [FIELDS.submissions.transcript]: canonical.transcript || "",
        [FIELDS.submissions.captions]: canonical.captions || {},
        [FIELDS.submissions.captionScoreTotal]:
          Number.isFinite(Number(canonical.captionScoreTotal)) ? Number(canonical.captionScoreTotal) : null,
        [FIELDS.submissions.computedFinalRatingJudge]:
          Number.isFinite(Number(canonical.computedFinalRatingJudge)) ?
              Number(canonical.computedFinalRatingJudge) :
              null,
        [FIELDS.submissions.computedFinalRatingLabel]:
          String(canonical.computedFinalRatingLabel || "N/A"),
        submittedAt:
          canonical.submittedAt ||
          admin.firestore.FieldValue.serverTimestamp(),
        releasedAt: admin.firestore.FieldValue.delete(),
        releasedBy: admin.firestore.FieldValue.delete(),
        [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    });
    officialDocs.forEach((docSnap, index) => {
      if (!docSnap.exists) return;
      tx.set(officialRefs[index], {
        [FIELDS.officialAssessments.status]: STATUSES.officialized,
        [FIELDS.officialAssessments.releasedAt]: admin.firestore.FieldValue.delete(),
        releasedBy: admin.firestore.FieldValue.delete(),
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
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

function sanitizeAssessmentCommentText(value) {
  return String(value || "").trim();
}

function applyAdminCommentEditsToCaptions(existingCaptions = {}, nextComments = {}) {
  const base = existingCaptions && typeof existingCaptions === "object" ? existingCaptions : {};
  const updates = nextComments && typeof nextComments === "object" ? nextComments : {};
  const result = {};
  Object.entries(base).forEach(([key, value]) => {
    const existingCaption = value && typeof value === "object" ? value : {};
    result[key] = {
      ...existingCaption,
      comment: Object.prototype.hasOwnProperty.call(updates, key) ?
        sanitizeAssessmentCommentText(updates[key]) :
        sanitizeAssessmentCommentText(existingCaption.comment || ""),
    };
  });
  return result;
}

exports.updateAssessmentComments = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertOpsLead(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const judgePosition = String(data.judgePosition || "").trim();
  const nextTranscript = sanitizeAssessmentCommentText(data.transcript || "");
  const nextCaptionComments =
    data.captions && typeof data.captions === "object" ? data.captions : {};

  if (!eventId || !ensembleId || !judgePosition) {
    throw new HttpsError(
        "invalid-argument",
        "eventId, ensembleId, and judgePosition required.",
    );
  }

  const submissionId = `${eventId}_${ensembleId}_${judgePosition}`;
  const db = admin.firestore();
  const submissionRef = db.collection(COLLECTIONS.submissions).doc(submissionId);
  const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(submissionId);

  await db.runTransaction(async (tx) => {
    const [submissionSnap, officialSnap] = await Promise.all([
      tx.get(submissionRef),
      tx.get(officialRef),
    ]);
    if (!submissionSnap.exists && !officialSnap.exists) {
      throw new HttpsError("not-found", "Assessment not found.");
    }

    const canonical = officialSnap.exists ? (officialSnap.data() || {}) : (submissionSnap.data() || {});
    const canonicalStatus = String(canonical.status || "").trim();
    if (canonicalStatus === STATUSES.released) {
      throw new HttpsError(
          "failed-precondition",
          "Released results must be unreleased before comment edits.",
      );
    }
    if (
      canonicalStatus !== STATUSES.submitted &&
      canonicalStatus !== STATUSES.officialized
    ) {
      throw new HttpsError(
          "failed-precondition",
          "Only submitted or officialized assessments can be edited.",
      );
    }

    const editStamp = {
      adminCommentEditedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminCommentEditedBy: request.auth.uid,
      adminCommentEditedByName: String(
          request.auth.token?.name ||
          request.auth.token?.email ||
          "",
      ).trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (submissionSnap.exists) {
      const current = submissionSnap.data() || {};
      tx.set(submissionRef, {
        [FIELDS.submissions.transcript]: nextTranscript,
        [FIELDS.submissions.captions]: applyAdminCommentEditsToCaptions(
            current.captions || {},
            nextCaptionComments,
        ),
        ...editStamp,
      }, {merge: true});
    }

    if (officialSnap.exists) {
      const current = officialSnap.data() || {};
      tx.set(officialRef, {
        [FIELDS.officialAssessments.transcript]: nextTranscript,
        [FIELDS.officialAssessments.writtenComments]: nextTranscript,
        [FIELDS.officialAssessments.captions]: applyAdminCommentEditsToCaptions(
            current.captions || {},
            nextCaptionComments,
        ),
        ...editStamp,
      }, {merge: true});
    }
  });

  return {
    ok: true,
    eventId,
    ensembleId,
    judgePosition,
  };
});

exports.generateOpenPacketPrintAsset = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = String(data.packetId || "").trim();
  if (!packetId) {
    throw new HttpsError("invalid-argument", "packetId required.");
  }

  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) {
    throw new HttpsError("not-found", "Packet not found.");
  }
  const packet = packetSnap.data() || {};
  const eventId = String(packet.officialEventId || packet.assignmentEventId || "").trim();
  const schoolId = String(packet.schoolId || "").trim();
  const ensembleId = String(packet.ensembleId || "").trim();
  let renderContext = {};
  if (schoolId) {
    renderContext = await loadStageSubmissionContext({
      db,
      eventId,
      ensembleId,
      schoolId,
    });
  }
  const pdfBytes = await renderOpenPacketPrintablePdf({
    packetId,
    packet,
    context: renderContext,
  });
  const objectPath = `open_exports/${packetId}/printable.pdf`;
  const saved = await saveStorageObjectWithToken({
    bucket: admin.storage().bucket(),
    objectPath,
    buffer: Buffer.from(pdfBytes),
    contentType: "application/pdf",
    metadata: {
      packetId,
      exportType: "open-packet-printable",
      templateVersion: DIRECTOR_PACKET_EXPORT_VERSION,
    },
  });
  const url = String(saved.url || "").trim();
  if (!url) {
    throw new HttpsError("internal", "Printable PDF generated but could not be linked.");
  }
  return {
    ok: true,
    packetId,
    pdfPath: saved.path,
    pdfUrl: url,
    formType: packet.formType || FORM_TYPES.stage,
    status: packet.status || "draft",
  };
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
  let exportSnap = await exportRef.get();
  let exportData = exportSnap.exists ? (exportSnap.data() || {}) : {};
  let schoolId = String(exportData.schoolId || "");

  if (!exportSnap.exists || String(exportData.status || "") !== "ready") {
    const grade = await resolvePerformanceGrade(eventId, ensembleId);
    if (grade) {
      const assessments = await loadCanonicalPacketAssessmentsForEvent({
        db,
        eventId,
        ensembleId,
        grade,
      });
      schoolId = String(
          schoolId ||
          assessments.find((item) => item.assessment?.schoolId)?.assessment?.schoolId ||
          "",
      );
      if (!isAdmin) {
        if (role !== "director") {
          throw new HttpsError("permission-denied", "Not authorized.");
        }
        if (!schoolId || String(user.schoolId || "") !== schoolId) {
          throw new HttpsError("permission-denied", "Not authorized for this school.");
        }
      }
      const releasable = assessments.length > 0 &&
        assessments.every((item) => item.assessment?.status === STATUSES.released);
      if (releasable) {
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
        }
        exportSnap = await exportRef.get();
        exportData = exportSnap.exists ? (exportSnap.data() || {}) : {};
        schoolId = String(exportData.schoolId || schoolId || "");
      }
    }
  }

  if (!exportSnap.exists) {
    throw new HttpsError("not-found", "Packet assets not found.");
  }
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
  const expiresAtMs = Date.now() + DIRECTOR_PACKET_EXPORT_TTL_MS;
  const judgeAssets = exportData.judgeAssets && typeof exportData.judgeAssets === "object" ?
    exportData.judgeAssets :
    {};
  const judgeKeys = Object.keys(judgeAssets);
  const signedJudges = {};
  for (const key of judgeKeys) {
    const item = judgeAssets[key] || {};
    const signedAudioSegments = await signAudioSegments(item.audioSegments || [], {expiresAtMs});
    signedJudges[key] = {
      ...item,
      pdfUrl: item.pdfPath ? await signStorageReadPath(item.pdfPath, {expiresAtMs}) : "",
      audioUrl: item.audioPath ?
        await signStorageReadPath(item.audioPath, {expiresAtMs}) :
        (item.audioUrl || ""),
      audioSegments: signedAudioSegments,
      supplementalAudioUrl: item.supplementalAudioPath ?
        await signStorageReadPath(item.supplementalAudioPath, {expiresAtMs}) :
        (item.supplementalAudioUrl || ""),
    };
  }
  const combinedPath = String(exportData.combinedPdfPath || "");
  const combinedUrl = combinedPath ? await signStorageReadPath(combinedPath, {expiresAtMs}) : "";
  return {
    status: "ready",
    templateVersion: exportData.templateVersion || "",
    generatedAt: exportData.generatedAt || null,
    error: exportData.error || "",
    combined: combinedPath ? {path: combinedPath, url: combinedUrl} : null,
    judges: signedJudges,
  };
});

exports.attachManualPacketAudio = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const targetType = String(data.targetType || "").trim().toLowerCase();
  const audioPath = String(data.audioPath || "").trim();
  const audioUrl = String(data.audioUrl || "").trim();
  const durationSec = Number(data.durationSec || 0);
  if (!audioPath || !audioUrl) {
    throw new HttpsError("invalid-argument", "audioPath and audioUrl are required.");
  }
  const db = admin.firestore();

  if (targetType === "scheduled") {
    const eventId = String(data.eventId || "").trim();
    const ensembleId = String(data.ensembleId || "").trim();
    const judgePosition = String(data.judgePosition || "").trim();
    if (!eventId || !ensembleId || !judgePosition) {
      throw new HttpsError(
          "invalid-argument",
          "eventId, ensembleId, and judgePosition are required for scheduled packets.",
      );
    }
    if (!Object.values(JUDGE_POSITIONS).includes(judgePosition)) {
      throw new HttpsError("invalid-argument", "Invalid judgePosition.");
    }
    const submissionId = `${eventId}_${ensembleId}_${judgePosition}`;
    const submissionRef = db.collection(COLLECTIONS.submissions).doc(submissionId);
    const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(submissionId);
    const submissionSnap = await submissionRef.get();
    if (!submissionSnap.exists) {
      throw new HttpsError("not-found", "Submission not found for that packet position.");
    }
    await submissionRef.set({
      supplementalAudioUrl: audioUrl,
      supplementalAudioPath: audioPath,
      supplementalAudioDurationSec: Number.isFinite(durationSec) ? durationSec : 0,
      [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    const officialSnap = await officialRef.get();
    if (officialSnap.exists) {
      await officialRef.set({
        supplementalAudioUrl: audioUrl,
        supplementalAudioPath: audioPath,
        supplementalAudioDurationSec: Number.isFinite(durationSec) ? durationSec : 0,
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    const exportRef = db
        .collection(COLLECTIONS.packetExports)
        .doc(buildDirectorPacketExportId(eventId, ensembleId));
    const exportSnap = await exportRef.get();
    if (exportSnap.exists) {
      const exportData = exportSnap.data() || {};
      const judgeAssets = exportData.judgeAssets && typeof exportData.judgeAssets === "object" ?
        {...exportData.judgeAssets} :
        {};
      const currentAsset = judgeAssets[judgePosition] && typeof judgeAssets[judgePosition] === "object" ?
        judgeAssets[judgePosition] :
        {};
      judgeAssets[judgePosition] = {
        ...currentAsset,
        supplementalAudioDurationSec: Number.isFinite(durationSec) ? durationSec : 0,
        supplementalAudioPath: audioPath,
        supplementalAudioUrl: "",
      };
      await exportRef.set({
        [FIELDS.packetExports.judgeAssets]: judgeAssets,
        [FIELDS.packetExports.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }

    return {ok: true, targetType, submissionId};
  }

  if (targetType === "open") {
    const packetId = String(data.packetId || "").trim();
    if (!packetId) {
      throw new HttpsError("invalid-argument", "packetId is required for open packets.");
    }
    const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
    const packetSnap = await packetRef.get();
    if (!packetSnap.exists) {
      throw new HttpsError("not-found", "Packet not found.");
    }
    await packetRef.set({
      supplementalLatestAudioPath: audioPath,
      supplementalLatestAudioUrl: audioUrl,
      supplementalLatestAudioDurationSec: Number.isFinite(durationSec) ? durationSec : 0,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    return {ok: true, targetType, packetId};
  }

  throw new HttpsError("invalid-argument", "targetType must be scheduled or open.");
});

exports.createAudioOnlyResult = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const schoolId = String(data.schoolId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  const ensembleName = String(data.ensembleName || "").trim();
  const mode = String(data.mode || "official").trim().toLowerCase() === "practice" ?
    "practice" :
    "official";
  const judgePosition = String(data.judgePosition || "").trim();
  const audioPath = String(data.audioPath || "").trim();
  const audioUrl = String(data.audioUrl || "").trim();
  const durationSec = Number(data.durationSec || 0);
  if (!eventId || !schoolId || !ensembleId || !audioPath || !audioUrl) {
    throw new HttpsError(
        "invalid-argument",
        "eventId, schoolId, ensembleId, audioPath, and audioUrl are required.",
    );
  }
  const db = admin.firestore();
  const schoolSnap = await db.collection(COLLECTIONS.schools).doc(schoolId).get();
  if (!schoolSnap.exists) {
    throw new HttpsError("not-found", "School not found.");
  }
  const audioRef = db.collection(COLLECTIONS.audioResults).doc();
  await audioRef.set({
    eventId,
    schoolId,
    ensembleId,
    ensembleName: ensembleName || ensembleId,
    mode,
    judgePosition: judgePosition || "",
    status: "draft",
    audioPath,
    audioUrl,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    uploadedBy: request.auth.uid,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    releasedAt: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, audioResultId: audioRef.id};
});

exports.releaseAudioOnlyResult = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const audioResultId = String(data.audioResultId || "").trim();
  if (!audioResultId) {
    throw new HttpsError("invalid-argument", "audioResultId required.");
  }
  const ref = admin.firestore().collection(COLLECTIONS.audioResults).doc(audioResultId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Audio result not found.");
  }
  await ref.set({
    status: "released",
    releasedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, audioResultId, status: "released"};
});

exports.unreleaseAudioOnlyResult = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const audioResultId = String(data.audioResultId || "").trim();
  if (!audioResultId) {
    throw new HttpsError("invalid-argument", "audioResultId required.");
  }
  const ref = admin.firestore().collection(COLLECTIONS.audioResults).doc(audioResultId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Audio result not found.");
  }
  await ref.set({
    status: "draft",
    releasedAt: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, audioResultId, status: "draft"};
});

exports.getDirectorAudioResultAsset = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const audioResultId = String(data.audioResultId || "").trim();
  if (!audioResultId) {
    throw new HttpsError("invalid-argument", "audioResultId required.");
  }
  const db = admin.firestore();
  const userSnap = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  const user = userSnap.exists ? (userSnap.data() || {}) : {};
  const isAdmin = isAdminProfile(user);
  const role = String(user.role || "");
  const resultRef = db.collection(COLLECTIONS.audioResults).doc(audioResultId);
  const resultSnap = await resultRef.get();
  if (!resultSnap.exists) {
    throw new HttpsError("not-found", "Audio result not found.");
  }
  const result = resultSnap.data() || {};
  if (!isAdmin) {
    if (role !== "director") {
      throw new HttpsError("permission-denied", "Not authorized.");
    }
    if (String(user.schoolId || "") !== String(result.schoolId || "")) {
      throw new HttpsError("permission-denied", "Not authorized for this school.");
    }
    if (String(result.status || "") !== "released") {
      throw new HttpsError("permission-denied", "Audio result is not released.");
    }
  }
  const expiresAtMs = Date.now() + DIRECTOR_PACKET_EXPORT_TTL_MS;
  const url = await signStorageReadPath(result.audioPath, {expiresAtMs});
  return {
    ok: true,
    audioResultId,
    audioUrl: url || String(result.audioUrl || ""),
    status: String(result.status || "draft"),
    eventId: String(result.eventId || ""),
    schoolId: String(result.schoolId || ""),
    ensembleId: String(result.ensembleId || ""),
    ensembleName: String(result.ensembleName || ""),
    mode: String(result.mode || "official"),
    judgePosition: String(result.judgePosition || ""),
    durationSec: Number(result.durationSec || 0),
  };
});

exports.repairManualAudioOverrides = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const dryRun = data.dryRun !== false;
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const summary = {
    dryRun,
    submissionsScanned: 0,
    submissionsUpdated: 0,
    officialAssessmentsUpdated: 0,
    packetsScanned: 0,
    packetsUpdated: 0,
    skippedNoCanonical: 0,
    samples: [],
  };

  const submissionsSnap = await db.collection(COLLECTIONS.submissions).get();
  for (const docSnap of submissionsSnap.docs) {
    summary.submissionsScanned += 1;
    const submissionId = docSnap.id;
    const submission = docSnap.data() || {};
    const currentPath = String(
        submission.audioPath || getStoragePathFromUrl(submission.audioUrl) || "",
    ).trim();
    if (!currentPath) continue;
    const isManualOverride = !currentPath.endsWith("/recording.webm");
    if (!isManualOverride) continue;
    const judgeUid = String(submission.judgeUid || "").trim();
    if (!judgeUid) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    const canonicalPath = `audio/${judgeUid}/${submissionId}/recording.webm`;
    const canonicalFile = bucket.file(canonicalPath);
    const [exists] = await canonicalFile.exists();
    if (!exists) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    const canonicalUrl = await signStorageReadPath(canonicalPath);
    if (!canonicalUrl) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    const patch = {
      supplementalAudioPath: currentPath,
      supplementalAudioUrl: String(submission.audioUrl || ""),
      supplementalAudioDurationSec: Number(submission.audioDurationSec || 0),
      [FIELDS.submissions.audioUrl]: canonicalUrl,
      audioPath: canonicalPath,
      [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };
    const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(submissionId);
    const officialSnap = await officialRef.get();
    const officialPatch = {
      supplementalAudioPath: currentPath,
      supplementalAudioUrl: String(submission.audioUrl || ""),
      supplementalAudioDurationSec: Number(submission.audioDurationSec || 0),
      [FIELDS.officialAssessments.audioUrl]: canonicalUrl,
      [FIELDS.officialAssessments.audioPath]: canonicalPath,
      [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };
    summary.samples.push({type: "submission", id: submissionId});
    if (!dryRun) {
      await docSnap.ref.set(patch, {merge: true});
      if (officialSnap.exists) {
        await officialRef.set(officialPatch, {merge: true});
      }
    }
    summary.submissionsUpdated += 1;
    if (officialSnap.exists) {
      summary.officialAssessmentsUpdated += 1;
    }
  }

  const packetsSnap = await db.collection(COLLECTIONS.packets).get();
  for (const docSnap of packetsSnap.docs) {
    summary.packetsScanned += 1;
    const packetId = docSnap.id;
    const packet = docSnap.data() || {};
    const currentPath = String(
        packet.latestAudioPath || getStoragePathFromUrl(packet.latestAudioUrl) || "",
    ).trim();
    if (!currentPath || !currentPath.includes("/manual/")) continue;
    const sessionsSnap = await docSnap.ref.collection("sessions").orderBy("startedAt", "asc").get();
    if (sessionsSnap.empty) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    let canonicalPath = "";
    let canonicalUrl = "";
    let totalDurationSec = 0;
    sessionsSnap.docs.forEach((sessionDoc) => {
      const session = sessionDoc.data() || {};
      const duration = Number(session.durationSec || 0);
      if (Number.isFinite(duration) && duration > 0) {
        totalDurationSec += duration;
      }
      if (canonicalPath) return;
      const path = String(
          session.masterAudioPath || getStoragePathFromUrl(session.masterAudioUrl) || "",
      ).trim();
      if (path) canonicalPath = path;
    });
    if (!canonicalPath) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    const canonicalFile = bucket.file(canonicalPath);
    const [exists] = await canonicalFile.exists();
    if (!exists) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    canonicalUrl = await signStorageReadPath(canonicalPath);
    if (!canonicalUrl) {
      summary.skippedNoCanonical += 1;
      continue;
    }
    const patch = {
      supplementalLatestAudioPath: currentPath,
      supplementalLatestAudioUrl: String(packet.latestAudioUrl || ""),
      supplementalLatestAudioDurationSec: Number(packet.tapeDurationSec || 0),
      [FIELDS.packets.latestAudioPath]: canonicalPath,
      [FIELDS.packets.latestAudioUrl]: canonicalUrl,
      [FIELDS.packets.tapeDurationSec]: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };
    summary.samples.push({type: "packet", id: packetId});
    if (!dryRun) {
      await docSnap.ref.set(patch, {merge: true});
    }
    summary.packetsUpdated += 1;
  }

  if (summary.samples.length > 25) {
    summary.samples = summary.samples.slice(0, 25);
  }
  return summary;
});

exports.repairOpenSubmissionAudioMetadata = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const dryRun = data.dryRun !== false;
  const db = admin.firestore();
  const summary = {
    dryRun,
    packetsScanned: 0,
    packetsUpdated: 0,
    submissionsUpdated: 0,
    officialAssessmentsUpdated: 0,
    exportsUpdated: 0,
    skippedNoSubmission: 0,
    skippedNoSessions: 0,
    samples: [],
  };

  const packetsSnap = await db.collection(COLLECTIONS.packets).get();
  for (const packetDoc of packetsSnap.docs) {
    summary.packetsScanned += 1;
    const packet = packetDoc.data() || {};
    const fallbackSubmissionId =
      packet.officialEventId &&
      packet.ensembleId &&
      packet.officialJudgePosition ?
        `${packet.officialEventId}_${packet.ensembleId}_${packet.officialJudgePosition}` :
        "";
    const officialSubmissionId =
      String(packet.officialSubmissionId || "").trim() || String(fallbackSubmissionId || "").trim();

    const sessionsSnap = await packetDoc.ref.collection("sessions").orderBy("startedAt", "asc").get();
    const audioSegments = buildAudioSegmentsFromSessionSnapshots(sessionsSnap.docs);
    if (!audioSegments.length) {
      summary.skippedNoSessions += 1;
      continue;
    }

    const primaryAudio = audioSegments[0] || null;
    const totalDurationSec = audioSegments.reduce((sum, segment) => {
      const value = Number(segment?.durationSec || 0);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);

    const packetPatch = {
      [FIELDS.packets.audioSegments]: audioSegments,
      [FIELDS.packets.latestAudioUrl]: primaryAudio?.audioUrl || String(packet.latestAudioUrl || ""),
      [FIELDS.packets.latestAudioPath]: primaryAudio?.audioPath || String(packet.latestAudioPath || ""),
      [FIELDS.packets.tapeDurationSec]: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
      [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };

    summary.samples.push({
      packetId: packetDoc.id,
      submissionId: officialSubmissionId || "",
      mode: String(packet.mode || "practice"),
    });
    summary.packetsUpdated += 1;

    if (!dryRun) {
      await packetDoc.ref.set(packetPatch, {merge: true});
    }

    if (!officialSubmissionId) {
      continue;
    }

    const submissionRef = db.collection(COLLECTIONS.submissions).doc(officialSubmissionId);
    const submissionSnap = await submissionRef.get();
    const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(officialSubmissionId);
    const officialSnap = await officialRef.get();
    if (!submissionSnap.exists) {
      summary.skippedNoSubmission += 1;
      continue;
    }

    const submission = submissionSnap.data() || {};
    const submissionPatch = {
      audioPath: primaryAudio?.audioPath || String(submission.audioPath || ""),
      [FIELDS.submissions.audioUrl]: primaryAudio?.audioUrl || String(submission.audioUrl || ""),
      [FIELDS.submissions.audioSegments]: audioSegments,
      [FIELDS.submissions.audioDurationSec]: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
      [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };
    const officialPatch = {
      [FIELDS.officialAssessments.audioPath]: primaryAudio?.audioPath || String(officialSnap.data()?.audioPath || ""),
      [FIELDS.officialAssessments.audioUrl]: primaryAudio?.audioUrl || String(officialSnap.data()?.audioUrl || ""),
      [FIELDS.officialAssessments.audioSegments]: audioSegments,
      [FIELDS.officialAssessments.audioDurationSec]: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
      [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    };

    const eventId = String(submission.eventId || packet.officialEventId || "").trim();
    const ensembleId = String(submission.ensembleId || packet.ensembleId || "").trim();
    const judgePosition = String(submission.judgePosition || packet.officialJudgePosition || "").trim();
    const exportPatch =
      eventId && ensembleId && judgePosition ?
        {
          [FIELDS.packetExports.judgeAssets]: {
            [judgePosition]: {
              ...(primaryAudio ? {
                audioUrl: primaryAudio.audioUrl,
                audioPath: primaryAudio.audioPath,
              } : {}),
              audioDurationSec: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
              audioSegments,
            },
          },
          [FIELDS.packetExports.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        } :
        null;

    if (!dryRun) {
      await submissionRef.set(submissionPatch, {merge: true});
      if (officialSnap.exists) {
        await officialRef.set(officialPatch, {merge: true});
      }
      if (exportPatch) {
        const exportRef = db
            .collection(COLLECTIONS.packetExports)
            .doc(buildDirectorPacketExportId(eventId, ensembleId));
        const exportSnap = await exportRef.get();
        if (exportSnap.exists) {
          const exportData = exportSnap.data() || {};
          const judgeAssets = exportData.judgeAssets && typeof exportData.judgeAssets === "object" ?
            {...exportData.judgeAssets} :
            {};
          const currentAsset = judgeAssets[judgePosition] && typeof judgeAssets[judgePosition] === "object" ?
            judgeAssets[judgePosition] :
            {};
          judgeAssets[judgePosition] = {
            ...currentAsset,
            ...(primaryAudio ? {
              audioUrl: primaryAudio.audioUrl,
              audioPath: primaryAudio.audioPath,
            } : {}),
            audioDurationSec: Number.isFinite(totalDurationSec) ? totalDurationSec : 0,
            audioSegments,
          };
          await exportRef.set({
            [FIELDS.packetExports.judgeAssets]: judgeAssets,
            [FIELDS.packetExports.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }
      }
    }
    summary.submissionsUpdated += 1;
    if (officialSnap.exists) {
      summary.officialAssessmentsUpdated += 1;
    }
    if (exportPatch) {
      summary.exportsUpdated += 1;
    }
  }

  return summary;
});

exports.repairPacketSubmissionLinkage = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const dryRun = data.dryRun !== false;
  const db = admin.firestore();
  const summary = {
    dryRun,
    packetsScanned: 0,
    packetsUpdated: 0,
    rawAssessmentsUpdated: 0,
    submissionsCloned: 0,
    submissionsMaterialized: 0,
    submissionsRepaired: 0,
    officialAssessmentsCloned: 0,
    officialAssessmentsMaterialized: 0,
    officialAssessmentsRepaired: 0,
    officialAssessmentPointersUpdated: 0,
    skippedPractice: 0,
    skippedIncomplete: 0,
    skippedConflicts: 0,
    skippedAlreadyCorrect: 0,
    samples: [],
  };

  const packetsSnap = await db.collection(COLLECTIONS.packets).get();
  const packetsByExpectedSubmissionId = new Map();
  packetsSnap.docs.forEach((packetDoc) => {
    const packet = packetDoc.data() || {};
    if (String(packet.mode || "").trim().toLowerCase() !== ADJUDICATION_MODES.official) return;
    const expectedSubmissionId = buildExpectedPacketOfficialSubmissionId(packet);
    if (!expectedSubmissionId) return;
    const existing = packetsByExpectedSubmissionId.get(expectedSubmissionId) || [];
    existing.push({
      id: packetDoc.id,
      updatedAtMs: packet.updatedAt?.toMillis ? packet.updatedAt.toMillis() : 0,
      judgeName: String(packet.createdByJudgeName || "").trim(),
      status: String(packet.status || "").trim(),
    });
    packetsByExpectedSubmissionId.set(expectedSubmissionId, existing);
  });
  for (const packetDoc of packetsSnap.docs) {
    summary.packetsScanned += 1;
    const packet = packetDoc.data() || {};
    if (String(packet.mode || "").trim().toLowerCase() !== ADJUDICATION_MODES.official) {
      summary.skippedPractice += 1;
      continue;
    }

    const expectedSubmissionId = buildExpectedPacketOfficialSubmissionId(packet);
    if (!expectedSubmissionId) {
      summary.skippedIncomplete += 1;
      continue;
    }
    const conflictingPackets = (packetsByExpectedSubmissionId.get(expectedSubmissionId) || [])
        .filter((item) => item.id !== packetDoc.id);
    if (conflictingPackets.length) {
      summary.skippedConflicts += 1;
      summary.samples.push({
        packetId: packetDoc.id,
        toSubmissionId: expectedSubmissionId,
        conflict: true,
        conflictingPacketIds: conflictingPackets.map((item) => item.id),
      });
      continue;
    }

    const currentSubmissionId = String(packet.officialSubmissionId || "").trim();
    const rawAssessmentId = buildRawAssessmentId({packetId: packetDoc.id});
    const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
    const expectedSubmissionRef = db.collection(COLLECTIONS.submissions).doc(expectedSubmissionId);
    const expectedOfficialRef = db.collection(COLLECTIONS.officialAssessments).doc(expectedSubmissionId);

    const refs = [rawRef, expectedSubmissionRef, expectedOfficialRef];
    if (currentSubmissionId && currentSubmissionId !== expectedSubmissionId) {
      refs.push(db.collection(COLLECTIONS.submissions).doc(currentSubmissionId));
      refs.push(db.collection(COLLECTIONS.officialAssessments).doc(currentSubmissionId));
    }
    const snaps = await db.getAll(...refs);
    const rawSnap = snaps[0];
    const expectedSubmissionSnap = snaps[1];
    const expectedOfficialSnap = snaps[2];
    const currentSubmissionSnap = snaps[3];
    const currentOfficialSnap = snaps[4];

    const raw = rawSnap?.exists ? (rawSnap.data() || {}) : null;
    const expectedSubmission = expectedSubmissionSnap?.exists ? (expectedSubmissionSnap.data() || {}) : null;
    const expectedOfficial = expectedOfficialSnap?.exists ? (expectedOfficialSnap.data() || {}) : null;
    const currentSubmission =
      currentSubmissionSnap?.exists && currentSubmissionId !== expectedSubmissionId ?
        (currentSubmissionSnap.data() || {}) :
        null;
    const currentOfficial =
      currentOfficialSnap?.exists && currentSubmissionId !== expectedSubmissionId ?
        (currentOfficialSnap.data() || {}) :
        null;

    const packetTranscript = String(packet.transcriptFull || packet.transcript || raw?.transcript || "").trim();
    const packetWrittenComments = String(
        packet.transcriptFull || packet.transcript || raw?.writtenComments || raw?.transcript || "",
    ).trim();
    const packetCaptions =
      packet.captions && typeof packet.captions === "object" ? packet.captions : {};
    const packetAudioSegments = Array.isArray(packet.audioSegments) ? packet.audioSegments : [];
    const packetAudioUrl = String(packet.canonicalAudioUrl || packet.latestAudioUrl || "").trim();
    const packetAudioPath = String(packet.canonicalAudioPath || packet.latestAudioPath || "").trim();
    const packetAudioDurationSec = Number(packet.canonicalAudioDurationSec || packet.tapeDurationSec || 0);
    const packetJudgePosition = String(packet.officialJudgePosition || packet.judgePosition || "").trim();
    const packetEventId = String(packet.officialEventId || packet.assignmentEventId || "").trim();
    const packetEnsembleId = String(packet.ensembleId || "").trim();
    const packetSchoolId = String(packet.schoolId || raw?.schoolId || "").trim();
    const packetJudgeName = String(packet.createdByJudgeName || raw?.judgeName || "").trim();
    const packetJudgeEmail = String(packet.createdByJudgeEmail || raw?.judgeEmail || "").trim();
    const packetJudgeUid = String(packet.createdByJudgeUid || raw?.judgeUid || "").trim();
    const packetFormType = String(packet.formType || FORM_TYPES.stage).trim();
    const packetSubmissionStatus = String(packet.status || "").trim() === "released" ?
      STATUSES.released :
      STATUSES.submitted;
    const packetOfficialStatus = String(packet.status || "").trim() === "released" ?
      STATUSES.released :
      STATUSES.officialized;
    const captionsJson = JSON.stringify(packetCaptions);
    const expectedSubmissionCaptionsJson = JSON.stringify(
        expectedSubmission?.captions && typeof expectedSubmission.captions === "object" ?
          expectedSubmission.captions :
          {},
    );
    const expectedOfficialCaptionsJson = JSON.stringify(
        expectedOfficial?.captions && typeof expectedOfficial.captions === "object" ?
          expectedOfficial.captions :
          {},
    );

    const shouldUpdatePacket =
      currentSubmissionId !== expectedSubmissionId ||
      String(packet.officialEventId || "").trim() !== String(packet.assignmentEventId || packet.officialEventId || "").trim() ||
      String(packet.officialJudgePosition || "").trim() !== String(packet.judgePosition || packet.officialJudgePosition || "").trim();
    const rawHasMismatch = Boolean(raw) && (
      String(raw?.eventId || "").trim() !== String(packet.officialEventId || packet.assignmentEventId || "").trim() ||
      String(raw?.ensembleId || "").trim() !== String(packet.ensembleId || "").trim() ||
      String(raw?.judgePosition || "").trim() !== String(packet.officialJudgePosition || packet.judgePosition || "").trim() ||
      String(raw?.schoolId || "").trim() !== String(packet.schoolId || raw?.schoolId || "").trim()
    );
    const shouldUpdateRaw = Boolean(rawHasMismatch);
    const shouldCloneSubmission = Boolean(currentSubmission && !expectedSubmission);
    const shouldMaterializeSubmission = Boolean(!expectedSubmission && !currentSubmission);
    const shouldCloneOfficial = Boolean(currentOfficial && !expectedOfficial);
    const shouldMaterializeOfficial = Boolean(!expectedOfficial && !currentOfficial);
    const shouldRepairSubmission = Boolean(expectedSubmission) && (
      String(expectedSubmission.eventId || "").trim() !== packetEventId ||
      String(expectedSubmission.ensembleId || "").trim() !== packetEnsembleId ||
      String(expectedSubmission.schoolId || "").trim() !== packetSchoolId ||
      String(expectedSubmission.judgePosition || "").trim() !== packetJudgePosition ||
      String(expectedSubmission.judgeName || "").trim() !== packetJudgeName ||
      String(expectedSubmission.judgeEmail || "").trim() !== packetJudgeEmail ||
      String(expectedSubmission.judgeUid || "").trim() !== packetJudgeUid ||
      String(expectedSubmission.formType || "").trim() !== packetFormType ||
      String(expectedSubmission.transcript || "").trim() !== packetTranscript ||
      String(expectedSubmission.audioUrl || "").trim() !== packetAudioUrl ||
      String(expectedSubmission.audioPath || "").trim() !== packetAudioPath ||
      Number(expectedSubmission.audioDurationSec || 0) !== packetAudioDurationSec ||
      JSON.stringify(Array.isArray(expectedSubmission.audioSegments) ? expectedSubmission.audioSegments : []) !==
        JSON.stringify(packetAudioSegments) ||
      expectedSubmissionCaptionsJson !== captionsJson ||
      Number(expectedSubmission.captionScoreTotal || 0) !== Number(packet.captionScoreTotal || 0) ||
      String(expectedSubmission.computedFinalRatingLabel || "").trim() !==
        String(packet.computedFinalRatingLabel || "").trim() ||
      Number(expectedSubmission.computedFinalRatingJudge || 0) !== Number(packet.computedFinalRatingJudge || 0)
    );
    const shouldRepairOfficial = Boolean(expectedOfficial) && (
      String(expectedOfficial.eventId || "").trim() !== packetEventId ||
      String(expectedOfficial.ensembleId || "").trim() !== packetEnsembleId ||
      String(expectedOfficial.schoolId || "").trim() !== packetSchoolId ||
      String(expectedOfficial.judgePosition || "").trim() !== packetJudgePosition ||
      String(expectedOfficial.judgeName || "").trim() !== packetJudgeName ||
      String(expectedOfficial.judgeEmail || "").trim() !== packetJudgeEmail ||
      String(expectedOfficial.judgeUid || "").trim() !== packetJudgeUid ||
      String(expectedOfficial.formType || "").trim() !== packetFormType ||
      String(expectedOfficial.transcript || "").trim() !== packetTranscript ||
      String(expectedOfficial.writtenComments || "").trim() !== packetWrittenComments ||
      String(expectedOfficial.audioUrl || "").trim() !== packetAudioUrl ||
      String(expectedOfficial.audioPath || "").trim() !== packetAudioPath ||
      Number(expectedOfficial.audioDurationSec || 0) !== packetAudioDurationSec ||
      JSON.stringify(Array.isArray(expectedOfficial.audioSegments) ? expectedOfficial.audioSegments : []) !==
        JSON.stringify(packetAudioSegments) ||
      expectedOfficialCaptionsJson !== captionsJson ||
      Number(expectedOfficial.captionScoreTotal || 0) !== Number(packet.captionScoreTotal || 0) ||
      String(expectedOfficial.computedFinalRatingLabel || "").trim() !==
        String(packet.computedFinalRatingLabel || "").trim() ||
      Number(expectedOfficial.computedFinalRatingJudge || 0) !== Number(packet.computedFinalRatingJudge || 0) ||
      String(expectedOfficial.sourceRawAssessmentId || "").trim() !== rawAssessmentId
    );
    const shouldUpdateOfficialPointer = Boolean(raw) &&
      Boolean(
          currentOfficial ||
          expectedOfficial ||
          shouldCloneOfficial ||
          shouldMaterializeOfficial ||
          shouldRepairOfficial ||
          String(raw?.status || "").trim() === STATUSES.officialized,
      ) &&
      String(raw?.officialAssessmentId || "").trim() !== expectedSubmissionId;

    if (
      !shouldUpdatePacket &&
      !shouldUpdateRaw &&
      !shouldCloneSubmission &&
      !shouldMaterializeSubmission &&
      !shouldRepairSubmission &&
      !shouldCloneOfficial &&
      !shouldMaterializeOfficial &&
      !shouldRepairOfficial &&
      !shouldUpdateOfficialPointer
    ) {
      summary.skippedAlreadyCorrect += 1;
      continue;
    }

    summary.samples.push({
      packetId: packetDoc.id,
      fromSubmissionId: currentSubmissionId || "",
      toSubmissionId: expectedSubmissionId,
      clonedSubmission: shouldCloneSubmission,
      materializedSubmission: shouldMaterializeSubmission,
      repairedSubmission: shouldRepairSubmission,
      clonedOfficialAssessment: shouldCloneOfficial,
      materializedOfficialAssessment: shouldMaterializeOfficial,
      repairedOfficialAssessment: shouldRepairOfficial,
    });
    summary.packetsUpdated += shouldUpdatePacket ? 1 : 0;
    summary.rawAssessmentsUpdated += shouldUpdateRaw ? 1 : 0;
    summary.submissionsCloned += shouldCloneSubmission ? 1 : 0;
    summary.submissionsMaterialized += shouldMaterializeSubmission ? 1 : 0;
    summary.submissionsRepaired += shouldRepairSubmission ? 1 : 0;
    summary.officialAssessmentsCloned += shouldCloneOfficial ? 1 : 0;
    summary.officialAssessmentsMaterialized += shouldMaterializeOfficial ? 1 : 0;
    summary.officialAssessmentsRepaired += shouldRepairOfficial ? 1 : 0;
    summary.officialAssessmentPointersUpdated += shouldUpdateOfficialPointer ? 1 : 0;

    if (dryRun) continue;

    const batch = db.batch();
    if (shouldUpdatePacket) {
      const officialEventId = String(packet.officialEventId || packet.assignmentEventId || "").trim();
      const officialJudgePosition = String(packet.officialJudgePosition || packet.judgePosition || "").trim();
      const packetPatch = {
        [FIELDS.packets.officialEventId]: officialEventId,
        [FIELDS.packets.officialJudgePosition]: officialJudgePosition,
        [FIELDS.packets.officialSubmissionId]: expectedSubmissionId,
        [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (
        !String(packet.officialAssessmentId || "").trim() ||
        String(packet.officialAssessmentId || "").trim() === currentSubmissionId
      ) {
        packetPatch[FIELDS.packets.officialAssessmentId] = expectedSubmissionId;
      }
      batch.set(packetDoc.ref, packetPatch, {merge: true});
    }
    if (shouldUpdateRaw || shouldUpdateOfficialPointer) {
      const rawPatch = {
        [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (shouldUpdateRaw) {
        rawPatch[FIELDS.rawAssessments.eventId] = String(packet.officialEventId || packet.assignmentEventId || "").trim();
        rawPatch[FIELDS.rawAssessments.ensembleId] = String(packet.ensembleId || "").trim();
        rawPatch[FIELDS.rawAssessments.schoolId] = String(packet.schoolId || raw?.schoolId || "").trim();
        rawPatch[FIELDS.rawAssessments.judgePosition] = String(packet.officialJudgePosition || packet.judgePosition || "").trim();
        rawPatch[FIELDS.rawAssessments.associationState] = "attached";
      }
      if (shouldUpdateOfficialPointer) {
        rawPatch[FIELDS.rawAssessments.officialAssessmentId] = expectedSubmissionId;
      }
      batch.set(rawRef, rawPatch, {merge: true});
    }
    if (shouldCloneSubmission) {
      batch.set(expectedSubmissionRef, {
        ...currentSubmission,
        [FIELDS.submissions.eventId]: String(packet.officialEventId || packet.assignmentEventId || "").trim(),
        [FIELDS.submissions.ensembleId]: String(packet.ensembleId || "").trim(),
        [FIELDS.submissions.schoolId]: String(packet.schoolId || currentSubmission.schoolId || "").trim(),
        [FIELDS.submissions.judgePosition]: String(packet.officialJudgePosition || packet.judgePosition || "").trim(),
        [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.submissions.createdAt]:
          currentSubmission.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    if (shouldMaterializeSubmission) {
      batch.set(expectedSubmissionRef, {
        [FIELDS.submissions.status]: packetSubmissionStatus,
        [FIELDS.submissions.locked]: true,
        [FIELDS.submissions.judgeUid]: packetJudgeUid,
        [FIELDS.submissions.judgeName]: packetJudgeName,
        [FIELDS.submissions.judgeEmail]: packetJudgeEmail,
        [FIELDS.submissions.schoolId]: packetSchoolId,
        [FIELDS.submissions.eventId]: packetEventId,
        [FIELDS.submissions.ensembleId]: packetEnsembleId,
        [FIELDS.submissions.judgePosition]: packetJudgePosition,
        [FIELDS.submissions.formType]: packetFormType,
        [FIELDS.submissions.audioUrl]: packetAudioUrl,
        audioPath: packetAudioPath,
        [FIELDS.submissions.audioSegments]: packetAudioSegments,
        [FIELDS.submissions.audioDurationSec]: packetAudioDurationSec,
        [FIELDS.submissions.transcript]: packetTranscript,
        [FIELDS.submissions.captions]: packetCaptions,
        [FIELDS.submissions.captionScoreTotal]:
          Number.isFinite(Number(packet.captionScoreTotal)) ? Number(packet.captionScoreTotal) : null,
        [FIELDS.submissions.computedFinalRatingJudge]:
          Number.isFinite(Number(packet.computedFinalRatingJudge)) ?
            Number(packet.computedFinalRatingJudge) :
            null,
        [FIELDS.submissions.computedFinalRatingLabel]:
          String(packet.computedFinalRatingLabel || "N/A"),
        [FIELDS.submissions.submittedAt]:
          packet.submittedAt || raw?.submittedAt || admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        createdAt:
          packet.createdAt || raw?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    if (shouldRepairSubmission) {
      batch.set(expectedSubmissionRef, {
        [FIELDS.submissions.status]: packetSubmissionStatus,
        [FIELDS.submissions.locked]: true,
        [FIELDS.submissions.judgeUid]: packetJudgeUid,
        [FIELDS.submissions.judgeName]: packetJudgeName,
        [FIELDS.submissions.judgeEmail]: packetJudgeEmail,
        [FIELDS.submissions.schoolId]: packetSchoolId,
        [FIELDS.submissions.eventId]: packetEventId,
        [FIELDS.submissions.ensembleId]: packetEnsembleId,
        [FIELDS.submissions.judgePosition]: packetJudgePosition,
        [FIELDS.submissions.formType]: packetFormType,
        [FIELDS.submissions.audioUrl]: packetAudioUrl,
        audioPath: packetAudioPath,
        [FIELDS.submissions.audioSegments]: packetAudioSegments,
        [FIELDS.submissions.audioDurationSec]: packetAudioDurationSec,
        [FIELDS.submissions.transcript]: packetTranscript,
        [FIELDS.submissions.captions]: packetCaptions,
        [FIELDS.submissions.captionScoreTotal]:
          Number.isFinite(Number(packet.captionScoreTotal)) ? Number(packet.captionScoreTotal) : null,
        [FIELDS.submissions.computedFinalRatingJudge]:
          Number.isFinite(Number(packet.computedFinalRatingJudge)) ?
            Number(packet.computedFinalRatingJudge) :
            null,
        [FIELDS.submissions.computedFinalRatingLabel]:
          String(packet.computedFinalRatingLabel || "N/A"),
        [FIELDS.submissions.submittedAt]:
          packet.submittedAt || expectedSubmission.submittedAt || raw?.submittedAt || admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    if (shouldCloneOfficial) {
      batch.set(expectedOfficialRef, {
        ...currentOfficial,
        [FIELDS.officialAssessments.eventId]: String(packet.officialEventId || packet.assignmentEventId || "").trim(),
        [FIELDS.officialAssessments.ensembleId]: String(packet.ensembleId || "").trim(),
        [FIELDS.officialAssessments.schoolId]: String(packet.schoolId || currentOfficial.schoolId || "").trim(),
        [FIELDS.officialAssessments.judgePosition]: String(packet.officialJudgePosition || packet.judgePosition || "").trim(),
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.officialAssessments.createdAt]:
          currentOfficial.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    if (shouldMaterializeOfficial) {
      batch.set(expectedOfficialRef, {
        [FIELDS.officialAssessments.status]: packetOfficialStatus,
        [FIELDS.officialAssessments.releaseEligible]: true,
        [FIELDS.officialAssessments.sourceRawAssessmentId]: rawAssessmentId,
        [FIELDS.officialAssessments.judgeUid]: packetJudgeUid,
        [FIELDS.officialAssessments.judgeName]: packetJudgeName,
        [FIELDS.officialAssessments.judgeEmail]: packetJudgeEmail,
        [FIELDS.officialAssessments.schoolId]: packetSchoolId,
        [FIELDS.officialAssessments.eventId]: packetEventId,
        [FIELDS.officialAssessments.ensembleId]: packetEnsembleId,
        [FIELDS.officialAssessments.judgePosition]: packetJudgePosition,
        [FIELDS.officialAssessments.formType]: packetFormType,
        [FIELDS.officialAssessments.audioUrl]: packetAudioUrl,
        [FIELDS.officialAssessments.audioPath]: packetAudioPath,
        [FIELDS.officialAssessments.audioSegments]: packetAudioSegments,
        [FIELDS.officialAssessments.audioDurationSec]: packetAudioDurationSec,
        [FIELDS.officialAssessments.transcript]: packetTranscript,
        [FIELDS.officialAssessments.writtenComments]: packetWrittenComments,
        [FIELDS.officialAssessments.captions]: packetCaptions,
        [FIELDS.officialAssessments.captionScoreTotal]:
          Number.isFinite(Number(packet.captionScoreTotal)) ? Number(packet.captionScoreTotal) : null,
        [FIELDS.officialAssessments.computedFinalRatingJudge]:
          Number.isFinite(Number(packet.computedFinalRatingJudge)) ?
            Number(packet.computedFinalRatingJudge) :
            null,
        [FIELDS.officialAssessments.computedFinalRatingLabel]:
          String(packet.computedFinalRatingLabel || "N/A"),
        [FIELDS.officialAssessments.reviewedAt]:
          raw?.reviewedAt || admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.officialAssessments.reviewedByUid]:
          String(raw?.reviewedByUid || request.auth.uid || ""),
        [FIELDS.officialAssessments.reviewedByName]:
          String(raw?.reviewedByName || "Packet Linkage Repair"),
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.officialAssessments.createdAt]:
          packet.createdAt || raw?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    if (shouldRepairOfficial) {
      batch.set(expectedOfficialRef, {
        [FIELDS.officialAssessments.status]: packetOfficialStatus,
        [FIELDS.officialAssessments.releaseEligible]: true,
        [FIELDS.officialAssessments.sourceRawAssessmentId]: rawAssessmentId,
        [FIELDS.officialAssessments.judgeUid]: packetJudgeUid,
        [FIELDS.officialAssessments.judgeName]: packetJudgeName,
        [FIELDS.officialAssessments.judgeEmail]: packetJudgeEmail,
        [FIELDS.officialAssessments.schoolId]: packetSchoolId,
        [FIELDS.officialAssessments.eventId]: packetEventId,
        [FIELDS.officialAssessments.ensembleId]: packetEnsembleId,
        [FIELDS.officialAssessments.judgePosition]: packetJudgePosition,
        [FIELDS.officialAssessments.formType]: packetFormType,
        [FIELDS.officialAssessments.audioUrl]: packetAudioUrl,
        [FIELDS.officialAssessments.audioPath]: packetAudioPath,
        [FIELDS.officialAssessments.audioSegments]: packetAudioSegments,
        [FIELDS.officialAssessments.audioDurationSec]: packetAudioDurationSec,
        [FIELDS.officialAssessments.transcript]: packetTranscript,
        [FIELDS.officialAssessments.writtenComments]: packetWrittenComments,
        [FIELDS.officialAssessments.captions]: packetCaptions,
        [FIELDS.officialAssessments.captionScoreTotal]:
          Number.isFinite(Number(packet.captionScoreTotal)) ? Number(packet.captionScoreTotal) : null,
        [FIELDS.officialAssessments.computedFinalRatingJudge]:
          Number.isFinite(Number(packet.computedFinalRatingJudge)) ?
            Number(packet.computedFinalRatingJudge) :
            null,
        [FIELDS.officialAssessments.computedFinalRatingLabel]:
          String(packet.computedFinalRatingLabel || "N/A"),
        [FIELDS.officialAssessments.reviewedAt]:
          raw?.reviewedAt || expectedOfficial.reviewedAt || admin.firestore.FieldValue.serverTimestamp(),
        [FIELDS.officialAssessments.reviewedByUid]:
          String(raw?.reviewedByUid || expectedOfficial.reviewedByUid || request.auth.uid || ""),
        [FIELDS.officialAssessments.reviewedByName]:
          String(raw?.reviewedByName || expectedOfficial.reviewedByName || "Packet Linkage Repair"),
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    await batch.commit();
  }

  if (summary.samples.length > 50) {
    summary.samples = summary.samples.slice(0, 50);
  }
  return summary;
});

exports.restoreCanonicalFromOpenPacket = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const packetId = String(data.packetId || "").trim();
  const dryRun = data.dryRun !== false;
  if (!packetId) {
    throw new HttpsError("invalid-argument", "packetId required.");
  }

  const db = admin.firestore();
  const packetRef = db.collection(COLLECTIONS.packets).doc(packetId);
  const packetSnap = await packetRef.get();
  if (!packetSnap.exists) {
    throw new HttpsError("not-found", "Open packet not found.");
  }
  const packet = packetSnap.data() || {};
  if (String(packet.mode || "").trim().toLowerCase() !== ADJUDICATION_MODES.official) {
    throw new HttpsError("failed-precondition", "Only official open packets can restore canonical records.");
  }

  const submissionId = buildExpectedPacketOfficialSubmissionId(packet);
  if (!submissionId) {
    throw new HttpsError(
        "failed-precondition",
        "Open packet is missing official event, ensemble, or judge position linkage.",
    );
  }

  const rawAssessmentId = buildRawAssessmentId({packetId});
  const rawRef = db.collection(COLLECTIONS.rawAssessments).doc(rawAssessmentId);
  const submissionRef = db.collection(COLLECTIONS.submissions).doc(submissionId);
  const officialRef = db.collection(COLLECTIONS.officialAssessments).doc(submissionId);
  const [rawSnap, submissionSnap, officialSnap] = await db.getAll(rawRef, submissionRef, officialRef);
  const raw = rawSnap.exists ? (rawSnap.data() || {}) : {};
  const existingSubmission = submissionSnap.exists ? (submissionSnap.data() || {}) : {};
  const existingOfficial = officialSnap.exists ? (officialSnap.data() || {}) : {};

  const transcript = String(packet.transcriptFull || packet.transcript || raw.transcript || "").trim();
  const writtenComments = String(
      packet.transcriptFull || packet.transcript || raw.writtenComments || raw.transcript || "",
  ).trim();
  const captions = packet.captions && typeof packet.captions === "object" ? packet.captions : {};
  const audioSegments = Array.isArray(packet.audioSegments) ? packet.audioSegments : [];
  const audioUrl = String(packet.canonicalAudioUrl || packet.latestAudioUrl || "").trim();
  const audioPath = String(packet.canonicalAudioPath || packet.latestAudioPath || "").trim();
  const audioDurationSec = Number(packet.canonicalAudioDurationSec || packet.tapeDurationSec || 0);
  const eventId = String(packet.officialEventId || packet.assignmentEventId || "").trim();
  const ensembleId = String(packet.ensembleId || "").trim();
  const schoolId = String(packet.schoolId || raw.schoolId || "").trim();
  const judgePosition = String(packet.officialJudgePosition || packet.judgePosition || "").trim();
  const judgeUid = String(packet.createdByJudgeUid || raw.judgeUid || "").trim();
  const judgeName = String(packet.createdByJudgeName || raw.judgeName || "").trim();
  const judgeEmail = String(packet.createdByJudgeEmail || raw.judgeEmail || "").trim();
  const formType = String(packet.formType || FORM_TYPES.stage).trim();
  const submissionStatus = String(packet.status || "").trim() === "released" ? STATUSES.released : STATUSES.submitted;
  const officialStatus = String(packet.status || "").trim() === "released" ? STATUSES.released : STATUSES.officialized;

  const result = {
    dryRun,
    packetId,
    submissionId,
    eventId,
    ensembleId,
    judgePosition,
    schoolId,
    packetJudgeName: judgeName,
    priorSubmissionJudgeName: String(existingSubmission.judgeName || "").trim(),
    priorOfficialJudgeName: String(existingOfficial.judgeName || "").trim(),
    restored: true,
  };

  if (dryRun) {
    return result;
  }

  const batch = db.batch();
  batch.set(packetRef, {
    [FIELDS.packets.officialEventId]: eventId,
    [FIELDS.packets.officialJudgePosition]: judgePosition,
    [FIELDS.packets.officialSubmissionId]: submissionId,
    [FIELDS.packets.officialAssessmentId]: submissionId,
    [FIELDS.packets.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  batch.set(rawRef, {
    [FIELDS.rawAssessments.eventId]: eventId,
    [FIELDS.rawAssessments.ensembleId]: ensembleId,
    [FIELDS.rawAssessments.schoolId]: schoolId,
    [FIELDS.rawAssessments.judgePosition]: judgePosition,
    [FIELDS.rawAssessments.associationState]: "attached",
    [FIELDS.rawAssessments.officialAssessmentId]: submissionId,
    [FIELDS.rawAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  batch.set(submissionRef, {
    [FIELDS.submissions.status]: submissionStatus,
    [FIELDS.submissions.locked]: true,
    [FIELDS.submissions.judgeUid]: judgeUid,
    [FIELDS.submissions.judgeName]: judgeName,
    [FIELDS.submissions.judgeEmail]: judgeEmail,
    [FIELDS.submissions.schoolId]: schoolId,
    [FIELDS.submissions.eventId]: eventId,
    [FIELDS.submissions.ensembleId]: ensembleId,
    [FIELDS.submissions.judgePosition]: judgePosition,
    [FIELDS.submissions.formType]: formType,
    [FIELDS.submissions.audioUrl]: audioUrl,
    audioPath,
    [FIELDS.submissions.audioSegments]: audioSegments,
    [FIELDS.submissions.audioDurationSec]: audioDurationSec,
    [FIELDS.submissions.transcript]: transcript,
    [FIELDS.submissions.captions]: captions,
    [FIELDS.submissions.captionScoreTotal]:
      Number.isFinite(Number(packet.captionScoreTotal)) ? Number(packet.captionScoreTotal) : null,
    [FIELDS.submissions.computedFinalRatingJudge]:
      Number.isFinite(Number(packet.computedFinalRatingJudge)) ? Number(packet.computedFinalRatingJudge) : null,
    [FIELDS.submissions.computedFinalRatingLabel]: String(packet.computedFinalRatingLabel || "N/A"),
    [FIELDS.submissions.submittedAt]:
      packet.submittedAt || existingSubmission.submittedAt || raw.submittedAt || admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.submissions.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.submissions.createdAt]:
      existingSubmission.createdAt || packet.createdAt || raw.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  batch.set(officialRef, {
    [FIELDS.officialAssessments.status]: officialStatus,
    [FIELDS.officialAssessments.releaseEligible]: true,
    [FIELDS.officialAssessments.sourceRawAssessmentId]: rawAssessmentId,
    [FIELDS.officialAssessments.judgeUid]: judgeUid,
    [FIELDS.officialAssessments.judgeName]: judgeName,
    [FIELDS.officialAssessments.judgeEmail]: judgeEmail,
    [FIELDS.officialAssessments.schoolId]: schoolId,
    [FIELDS.officialAssessments.eventId]: eventId,
    [FIELDS.officialAssessments.ensembleId]: ensembleId,
    [FIELDS.officialAssessments.judgePosition]: judgePosition,
    [FIELDS.officialAssessments.formType]: formType,
    [FIELDS.officialAssessments.audioUrl]: audioUrl,
    [FIELDS.officialAssessments.audioPath]: audioPath,
    [FIELDS.officialAssessments.audioSegments]: audioSegments,
    [FIELDS.officialAssessments.audioDurationSec]: audioDurationSec,
    [FIELDS.officialAssessments.transcript]: transcript,
    [FIELDS.officialAssessments.writtenComments]: writtenComments,
    [FIELDS.officialAssessments.captions]: captions,
    [FIELDS.officialAssessments.captionScoreTotal]:
      Number.isFinite(Number(packet.captionScoreTotal)) ? Number(packet.captionScoreTotal) : null,
    [FIELDS.officialAssessments.computedFinalRatingJudge]:
      Number.isFinite(Number(packet.computedFinalRatingJudge)) ? Number(packet.computedFinalRatingJudge) : null,
    [FIELDS.officialAssessments.computedFinalRatingLabel]: String(packet.computedFinalRatingLabel || "N/A"),
    [FIELDS.officialAssessments.reviewedAt]:
      raw.reviewedAt || existingOfficial.reviewedAt || admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.officialAssessments.reviewedByUid]:
      String(raw.reviewedByUid || existingOfficial.reviewedByUid || request.auth.uid || ""),
    [FIELDS.officialAssessments.reviewedByName]:
      String(raw.reviewedByName || existingOfficial.reviewedByName || "Open Sheet Restore"),
    [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
    [FIELDS.officialAssessments.createdAt]:
      existingOfficial.createdAt || packet.createdAt || raw.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  await batch.commit();

  return result;
});

exports.releaseMockPacketForAshleyTesting = onCall(APPCHECK_SENSITIVE_OPTIONS, async (request) => {
  await assertAdmin(request);
  assertDestructiveAdminToolsAllowed("releaseMockPacketForAshleyTesting");
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
  const officialRef = db
      .collection(COLLECTIONS.officialAssessments)
      .doc(submissionId);
  await db.runTransaction(async (tx) => {
    const [submissionSnap, officialSnap] = await Promise.all([
      tx.get(submissionRef),
      tx.get(officialRef),
    ]);
    if (!submissionSnap.exists && !officialSnap.exists) {
      throw new HttpsError("not-found", "Submission not found.");
    }
    const canonical = officialSnap.exists ? officialSnap.data() || {} : submissionSnap.data() || {};
    if (
      canonical.status !== STATUSES.submitted &&
      canonical.status !== STATUSES.officialized
    ) {
      throw new HttpsError(
          "failed-precondition",
          "Only submitted or officialized packets can be unlocked.",
      );
    }
    if (canonical.locked !== true) {
      throw new HttpsError(
          "failed-precondition",
          "Submission is already unlocked.",
      );
    }
    const unlockedAt = admin.firestore.FieldValue.serverTimestamp();
    if (submissionSnap.exists) {
      tx.update(submissionRef, {
        [FIELDS.submissions.locked]: false,
        unlockedAt,
        unlockedBy: request.auth.uid,
      });
    }
    if (officialSnap.exists) {
      tx.update(officialRef, {
        [FIELDS.officialAssessments.locked]: false,
        unlockedAt,
        unlockedBy: request.auth.uid,
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
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
  const officialRef = db
      .collection(COLLECTIONS.officialAssessments)
      .doc(submissionId);
  await db.runTransaction(async (tx) => {
    const [submissionSnap, officialSnap] = await Promise.all([
      tx.get(submissionRef),
      tx.get(officialRef),
    ]);
    if (!submissionSnap.exists && !officialSnap.exists) {
      throw new HttpsError("not-found", "Submission not found.");
    }
    const canonical = officialSnap.exists ? officialSnap.data() || {} : submissionSnap.data() || {};
    if (
      canonical.status !== STATUSES.submitted &&
      canonical.status !== STATUSES.released &&
      canonical.status !== STATUSES.officialized
    ) {
      throw new HttpsError(
          "failed-precondition",
          "Only submitted, officialized, or released submissions can be locked.",
      );
    }
    if (canonical.locked === true) {
      throw new HttpsError(
          "failed-precondition",
          "Submission is already locked.",
      );
    }
    if (submissionSnap.exists) {
      tx.update(submissionRef, {
        [FIELDS.submissions.locked]: true,
      });
    }
    if (officialSnap.exists) {
      tx.update(officialRef, {
        [FIELDS.officialAssessments.locked]: true,
        [FIELDS.officialAssessments.updatedAt]: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
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
  if (!["admin", "teamLead", "judge", "director", "checkin"].includes(role)) {
    throw new HttpsError(
        "invalid-argument",
        "Role must be admin, teamLead, judge, director, or checkin.",
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
          checkin: role === "checkin",
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

async function collectDeleteUserBlockers({
  db,
  targetUid,
  targetProfile = {},
} = {}) {
  const blockers = [];
  const schoolId = String(targetProfile.schoolId || "").trim();
  if (schoolId) {
    blockers.push({
      code: "school-assigned",
      message: "User is still assigned to a school.",
      details: {schoolId},
    });
  }

  const eventsSnap = await db.collection(COLLECTIONS.events).get();
  const assignmentEvents = [];
  for (const eventDoc of eventsSnap.docs) {
    const assignmentsSnap = await db
        .collection(COLLECTIONS.events)
        .doc(eventDoc.id)
        .collection(COLLECTIONS.assignments)
        .doc("positions")
        .get();
    if (!assignmentsSnap.exists) continue;
    const assignments = assignmentsSnap.data() || {};
    const assigned =
      assignments.stage1Uid === targetUid ||
      assignments.stage2Uid === targetUid ||
      assignments.stage3Uid === targetUid ||
      assignments.sightUid === targetUid;
    if (assigned) assignmentEvents.push(eventDoc.id);
  }
  if (assignmentEvents.length) {
    blockers.push({
      code: "judge-assignments-exist",
      message: "User is referenced in judge assignments.",
      details: {eventIds: assignmentEvents},
    });
  }

  const [
    submissionsSnap,
    officialAssessmentsSnap,
    packetsSnap,
  ] = await Promise.all([
    db.collection(COLLECTIONS.submissions)
        .where(FIELDS.submissions.judgeUid, "==", targetUid)
        .limit(1)
        .get(),
    db.collection(COLLECTIONS.officialAssessments)
        .where(FIELDS.officialAssessments.judgeUid, "==", targetUid)
        .limit(1)
        .get(),
    db.collection(COLLECTIONS.packets)
        .where(FIELDS.packets.createdByJudgeUid, "==", targetUid)
        .limit(1)
        .get(),
  ]);

  if (!submissionsSnap.empty) {
    blockers.push({
      code: "submissions-exist",
      message: "User still owns one or more submissions.",
      details: {sampleSubmissionId: submissionsSnap.docs[0].id},
    });
  }
  if (!officialAssessmentsSnap.empty) {
    blockers.push({
      code: "official-assessments-exist",
      message: "User still owns one or more official assessments.",
      details: {sampleOfficialAssessmentId: officialAssessmentsSnap.docs[0].id},
    });
  }
  if (!packetsSnap.empty) {
    blockers.push({
      code: "packets-exist",
      message: "User still owns one or more open packets.",
      details: {samplePacketId: packetsSnap.docs[0].id},
    });
  }
  let hasEntryUserReference = false;
  for (const eventDoc of eventsSnap.docs) {
    const [createdSnap, registeredSnap, readySnap] = await Promise.all([
      db.collection(COLLECTIONS.events)
          .doc(eventDoc.id)
          .collection(COLLECTIONS.entries)
          .where("createdByUid", "==", targetUid)
          .limit(1)
          .get(),
      db.collection(COLLECTIONS.events)
          .doc(eventDoc.id)
          .collection(COLLECTIONS.entries)
          .where("registeredByUid", "==", targetUid)
          .limit(1)
          .get(),
      db.collection(COLLECTIONS.events)
          .doc(eventDoc.id)
          .collection(COLLECTIONS.entries)
          .where("readyByUid", "==", targetUid)
          .limit(1)
          .get(),
    ]);
    if (!createdSnap.empty || !registeredSnap.empty || !readySnap.empty) {
      hasEntryUserReference = true;
      break;
    }
  }
  if (hasEntryUserReference) {
    blockers.push({
      code: "event-entries-exist",
      message: "User is referenced by event entry metadata.",
    });
  }

  return blockers;
}

exports.deleteUserAccount = onCall(async (request) => {
  await assertAdmin(request);
  const data = request.data || {};
  const targetUid = String(data.targetUid || "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }
  if (targetUid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  }

  const db = admin.firestore();
  const userRef = db.collection(COLLECTIONS.users).doc(targetUid);
  const userSnap = await userRef.get();
  let targetAuthUser = null;
  try {
    targetAuthUser = await admin.auth().getUser(targetUid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Failed to load auth user.");
    }
  }
  if (!userSnap.exists && !targetAuthUser) {
    throw new HttpsError("not-found", "User not found.");
  }

  const targetProfile = userSnap.exists ? (userSnap.data() || {}) : {};
  const targetRole = getEffectiveRole(targetProfile);
  if (targetRole === "admin" || targetRole === "teamLead") {
    const usersSnap = await db.collection(COLLECTIONS.users).get();
    const adminCount = usersSnap.docs.reduce((count, docSnap) => {
      return count + (isAdminProfile(docSnap.data() || {}) ? 1 : 0);
    }, 0);
    if (adminCount <= 1) {
      throw new HttpsError(
          "failed-precondition",
          "Cannot delete the last admin account.",
      );
    }
  }

  const blockers = await collectDeleteUserBlockers({
    db,
    targetUid,
    targetProfile,
  });
  if (blockers.length) {
    throw new HttpsError(
        "failed-precondition",
        "User cannot be deleted until blockers are cleared.",
        {blockers},
    );
  }

  const cardPath = String(targetProfile.nafmeCardImagePath || "").trim();
  if (cardPath) {
    try {
      await admin.storage().bucket().file(cardPath).delete({ignoreNotFound: true});
    } catch (error) {
      logger.warn("deleteUserAccount card cleanup failed", {
        targetUid,
        cardPath,
        error: error?.message || String(error),
      });
    }
  }

  let firestoreDeleted = false;
  if (userSnap.exists) {
    await userRef.delete();
    firestoreDeleted = true;
  }
  await db.collection("rateLimits").doc(targetUid).delete();

  let authDeleted = false;
  try {
    await admin.auth().deleteUser(targetUid);
    authDeleted = true;
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Failed to delete auth user.");
    }
  }

  logger.info("deleteUserAccount", {
    actorUid: request.auth.uid,
    targetUid,
    targetRole: targetRole || null,
    firestoreDeleted,
    authDeleted,
  });
  return {
    deleted: true,
    uid: targetUid,
    firestoreDeleted,
    authDeleted,
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

exports.repairDirectorEntrySchoolMismatch = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const eventId = String(data.eventId || "").trim();
  const ensembleId = String(data.ensembleId || "").trim();
  if (!eventId || !ensembleId) {
    throw new HttpsError("invalid-argument", "eventId and ensembleId are required.");
  }

  const db = admin.firestore();
  const userSnap = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  const profile = userSnap.exists ? (userSnap.data() || {}) : {};
  const role = getEffectiveRole(profile);
  const isAdmin = isAdminProfile(profile);
  if (!isAdmin && role !== "director") {
    throw new HttpsError("permission-denied", "Director or admin access required.");
  }

  const schoolId = String(
      isAdmin ? (data.schoolId || profile.schoolId || "") : (profile.schoolId || ""),
  ).trim();
  if (!schoolId) {
    throw new HttpsError("failed-precondition", "Director is not attached to a school.");
  }

  const ensembleRef = db
      .collection(COLLECTIONS.schools)
      .doc(schoolId)
      .collection("ensembles")
      .doc(ensembleId);
  const entryRef = db
      .collection(COLLECTIONS.events)
      .doc(eventId)
      .collection(COLLECTIONS.entries)
      .doc(ensembleId);

  const [ensembleSnap, entrySnap] = await Promise.all([
    ensembleRef.get(),
    entryRef.get(),
  ]);

  if (!ensembleSnap.exists) {
    return {
      ok: false,
      repaired: false,
      reason: "ensemble-not-found-for-school",
      schoolId,
      eventId,
      ensembleId,
    };
  }
  if (!entrySnap.exists) {
    return {
      ok: false,
      repaired: false,
      reason: "entry-not-found",
      schoolId,
      eventId,
      ensembleId,
    };
  }

  const entry = entrySnap.data() || {};
  const previousSchoolId = String(entry.schoolId || "").trim();
  if (previousSchoolId === schoolId) {
    return {
      ok: true,
      repaired: false,
      reason: "already-matched",
      schoolId,
      previousSchoolId,
      eventId,
      ensembleId,
    };
  }

  await entryRef.set({
    schoolId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    ok: true,
    repaired: true,
    schoolId,
    previousSchoolId,
    eventId,
    ensembleId,
  };
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

    const officialAssessmentsSnap = await db
        .collection(COLLECTIONS.officialAssessments)
        .where(FIELDS.officialAssessments.ensembleId, "==", ensembleId)
        .limit(1)
        .get();
    if (!officialAssessmentsSnap.empty) {
      throw new HttpsError(
          "failed-precondition",
          "Official assessments exist for this ensemble.",
      );
    }

    await ensembleRef.delete();
    return {deleted: true, forced: false};
  }

  let deletedEntries = 0;
  let deletedSchedule = 0;
  let deletedSubmissions = 0;
  let deletedOfficialAssessments = 0;
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

  const officialAssessmentsSnap = await db
      .collection(COLLECTIONS.officialAssessments)
      .where(FIELDS.officialAssessments.ensembleId, "==", ensembleId)
      .get();
  if (!officialAssessmentsSnap.empty) {
    const targetDocs = officialAssessmentsSnap.docs.filter((docSnap) => {
      const row = docSnap.data() || {};
      const rowSchoolId = String(row.schoolId || "");
      return !rowSchoolId || rowSchoolId === schoolId;
    });
    deletedOfficialAssessments += await deleteDocsInBatches(targetDocs);
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
    deletedOfficialAssessments,
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
    deletedOfficialAssessments,
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

  const submissionsSnap = await db
      .collection(COLLECTIONS.submissions)
      .where(FIELDS.submissions.schoolId, "==", schoolId)
      .limit(1)
      .get();
  if (!submissionsSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Scheduled submissions are linked to this school.",
    );
  }

  const officialAssessmentsSnap = await db
      .collection(COLLECTIONS.officialAssessments)
      .where(FIELDS.officialAssessments.schoolId, "==", schoolId)
      .limit(1)
      .get();
  if (!officialAssessmentsSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Official assessments are linked to this school.",
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

  const releasedOfficialSnap = await db
      .collection(COLLECTIONS.officialAssessments)
      .where(FIELDS.officialAssessments.eventId, "==", eventId)
      .where(FIELDS.officialAssessments.status, "==", STATUSES.released)
      .limit(1)
      .get();
  if (!releasedOfficialSnap.empty) {
    throw new HttpsError(
        "failed-precondition",
        "Cannot delete event: released official assessments exist.",
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

  lastDoc = null;
  hasMore = true;
  while (hasMore) {
    let queryRef = db
        .collection(COLLECTIONS.officialAssessments)
        .where(FIELDS.officialAssessments.eventId, "==", eventId)
        .orderBy(FIELDS.officialAssessments.eventId)
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
