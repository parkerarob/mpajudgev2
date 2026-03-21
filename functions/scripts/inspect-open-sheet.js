const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "mpa-judge-v2";

admin.initializeApp({projectId});

const db = admin.firestore();

function summarizeAudioSegments(segments = []) {
  return (Array.isArray(segments) ? segments : []).map((segment, index) => ({
    index,
    sessionId: String(segment?.sessionId || segment?.id || "").trim(),
    label: String(segment?.label || "").trim(),
    audioUrl: String(segment?.audioUrl || "").trim(),
    audioPath: String(segment?.audioPath || "").trim(),
    durationSec: Number(segment?.durationSec || 0),
    sortOrder: Number(segment?.sortOrder ?? index),
  }));
}

async function main() {
  const packetId = String(process.argv[2] || "").trim();
  if (!packetId) {
    throw new Error("Usage: node functions/scripts/inspect-open-sheet.js <packetId>");
  }

  const packetRef = db.collection("packets").doc(packetId);
  const sessionsRef = packetRef.collection("sessions");
  const rawRef = db.collection("rawAssessments").doc(packetId);
  const [packetSnap, rawSnap, sessionsSnap] = await Promise.all([
    packetRef.get(),
    rawRef.get(),
    sessionsRef.get(),
  ]);

  if (!packetSnap.exists) {
    throw new Error(`Open sheet not found: ${packetId}`);
  }

  const packet = packetSnap.data() || {};
  const raw = rawSnap.exists ? rawSnap.data() || {} : null;
  const sessions = sessionsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
  const canonicalId = String(
      packet.officialSubmissionId || packet.officialAssessmentId || raw?.officialAssessmentId || "",
  ).trim();

  let submission = null;
  let officialAssessment = null;
  if (canonicalId) {
    const [submissionSnap, officialSnap] = await Promise.all([
      db.collection("submissions").doc(canonicalId).get(),
      db.collection("officialAssessments").doc(canonicalId).get(),
    ]);
    submission = submissionSnap.exists ? submissionSnap.data() || {} : null;
    officialAssessment = officialSnap.exists ? officialSnap.data() || {} : null;
  }

  const output = {
    packetId,
    packet: {
      status: packet.status || "",
      mode: packet.mode || "",
      schoolId: packet.schoolId || "",
      schoolName: packet.schoolName || "",
      ensembleId: packet.ensembleId || "",
      ensembleName: packet.ensembleName || "",
      assignmentEventId: packet.assignmentEventId || "",
      officialEventId: packet.officialEventId || "",
      judgePosition: packet.judgePosition || "",
      officialJudgePosition: packet.officialJudgePosition || "",
      formType: packet.formType || "",
      createdByJudgeName: packet.createdByJudgeName || "",
      createdByJudgeEmail: packet.createdByJudgeEmail || "",
      officialSubmissionId: packet.officialSubmissionId || "",
      officialAssessmentId: packet.officialAssessmentId || "",
      latestAudioUrl: packet.latestAudioUrl || "",
      latestAudioPath: packet.latestAudioPath || "",
      canonicalAudioUrl: packet.canonicalAudioUrl || "",
      canonicalAudioPath: packet.canonicalAudioPath || "",
      tapeDurationSec: Number(packet.tapeDurationSec || 0),
      canonicalAudioDurationSec: Number(packet.canonicalAudioDurationSec || 0),
      audioSegmentsCount: Array.isArray(packet.audioSegments) ? packet.audioSegments.length : 0,
      audioSegments: summarizeAudioSegments(packet.audioSegments || []),
      transcriptLength: String(packet.transcriptFull || packet.transcript || "").trim().length,
      transcriptPreview: String(packet.transcriptFull || packet.transcript || "").trim().slice(0, 300),
      updatedAt: packet.updatedAt || null,
      submittedAt: packet.submittedAt || null,
      releasedAt: packet.releasedAt || null,
    },
    rawAssessment: raw ?
      {
        status: raw.status || "",
        reviewState: raw.reviewState || "",
        associationState: raw.associationState || "",
        officialAssessmentId: raw.officialAssessmentId || "",
        eventId: raw.eventId || "",
        ensembleId: raw.ensembleId || "",
        schoolId: raw.schoolId || "",
        judgePosition: raw.judgePosition || "",
        transcriptLength: String(raw.transcript || "").trim().length,
      } :
      null,
    canonical: canonicalId ?
      {
        id: canonicalId,
        submission: submission ?
          {
            status: submission.status || "",
            audioUrl: submission.audioUrl || "",
            audioPath: submission.audioPath || "",
            audioDurationSec: Number(submission.audioDurationSec || 0),
            audioSegmentsCount: Array.isArray(submission.audioSegments) ? submission.audioSegments.length : 0,
            audioSegments: summarizeAudioSegments(submission.audioSegments || []),
            transcriptLength: String(submission.transcript || "").trim().length,
            releasedAt: submission.releasedAt || null,
          } :
          null,
        officialAssessment: officialAssessment ?
          {
            status: officialAssessment.status || "",
            audioUrl: officialAssessment.audioUrl || "",
            audioPath: officialAssessment.audioPath || "",
            audioDurationSec: Number(officialAssessment.audioDurationSec || 0),
            audioSegmentsCount: Array.isArray(officialAssessment.audioSegments) ?
              officialAssessment.audioSegments.length :
              0,
            audioSegments: summarizeAudioSegments(officialAssessment.audioSegments || []),
            transcriptLength: String(officialAssessment.transcript || "").trim().length,
            releasedAt: officialAssessment.releasedAt || null,
          } :
          null,
      } :
      null,
    sessions: {
      count: sessions.length,
      items: sessions.map((session) => ({
        id: session.id,
        status: session.status || "",
        transcriptStatus: session.transcriptStatus || "",
        transcriptLength: String(session.transcript || "").trim().length,
        needsUpload: Boolean(session.needsUpload),
        audioUrl: String(session.audioUrl || "").trim(),
        audioPath: String(session.audioPath || "").trim(),
        masterAudioUrl: String(session.masterAudioUrl || "").trim(),
        masterAudioPath: String(session.masterAudioPath || "").trim(),
        durationSec: Number(session.durationSec || 0),
        createdAt: session.createdAt || null,
        updatedAt: session.updatedAt || null,
      })),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
