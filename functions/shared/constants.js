const COLLECTIONS = {
  users: "users",
  schools: "schools",
  events: "events",
  schedule: "schedule",
  assignments: "assignments",
  submissions: "submissions",
  packets: "packets",
  ensembles: "ensembles",
  entries: "entries",
};

const FIELDS = {
  users: {
    role: "role",
    schoolId: "schoolId",
    roles: "roles",
    email: "email",
  },
  schools: {
    directors: "directors",
  },
  events: {
    isActive: "isActive",
    name: "name",
  },
  schedule: {
    orderIndex: "orderIndex",
    stageTime: "stageTime",
    schoolId: "schoolId",
    ensembleId: "ensembleId",
  },
  submissions: {
    status: "status",
    locked: "locked",
    judgeUid: "judgeUid",
    judgeName: "judgeName",
    judgeEmail: "judgeEmail",
    judgeTitle: "judgeTitle",
    judgeAffiliation: "judgeAffiliation",
    schoolId: "schoolId",
    eventId: "eventId",
    ensembleId: "ensembleId",
    judgePosition: "judgePosition",
    formType: "formType",
    audioUrl: "audioUrl",
    audioDurationSec: "audioDurationSec",
    transcript: "transcript",
    captions: "captions",
    captionScoreTotal: "captionScoreTotal",
    computedFinalRatingJudge: "computedFinalRatingJudge",
    computedFinalRatingLabel: "computedFinalRatingLabel",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  packets: {
    status: "status",
    locked: "locked",
    createdByJudgeUid: "createdByJudgeUid",
    createdByJudgeName: "createdByJudgeName",
    createdByJudgeEmail: "createdByJudgeEmail",
    schoolName: "schoolName",
    ensembleName: "ensembleName",
    schoolId: "schoolId",
    ensembleId: "ensembleId",
    ensembleSnapshot: "ensembleSnapshot",
    formType: "formType",
    transcript: "transcript",
    transcriptFull: "transcriptFull",
    transcriptStatus: "transcriptStatus",
    transcriptError: "transcriptError",
    captions: "captions",
    captionScoreTotal: "captionScoreTotal",
    computedFinalRatingJudge: "computedFinalRatingJudge",
    computedFinalRatingLabel: "computedFinalRatingLabel",
    audioSessionCount: "audioSessionCount",
    activeSessionId: "activeSessionId",
    latestAudioUrl: "latestAudioUrl",
    latestAudioPath: "latestAudioPath",
    eventId: "eventId",
    scheduleEntryId: "scheduleEntryId",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    submittedAt: "submittedAt",
    releasedAt: "releasedAt",
    tapeDurationSec: "tapeDurationSec",
    segmentCount: "segmentCount",
  },
  entries: {
    performanceGrade: "performanceGrade",
  },
};

const STATUSES = {
  submitted: "submitted",
  released: "released",
};

const FORM_TYPES = {
  stage: "stage",
  sight: "sight",
};

const JUDGE_POSITIONS = {
  stage1: "stage1",
  stage2: "stage2",
  stage3: "stage3",
  sight: "sight",
};

const CAPTION_TEMPLATES = {
  stage: [
    {key: "toneQuality", label: "Tone Quality"},
    {key: "intonation", label: "Intonation"},
    {key: "balanceBlend", label: "Balance/Blend"},
    {key: "precision", label: "Precision"},
    {key: "basicMusicianship", label: "Basic Musicianship"},
    {key: "interpretativeMusicianship", label: "Interpretative Musicianship"},
    {key: "generalFactors", label: "General Factors"},
  ],
  sight: [
    {key: "toneQuality", label: "Tone Quality"},
    {key: "intonation", label: "Intonation"},
    {key: "balance", label: "Balance"},
    {key: "technique", label: "Technique"},
    {key: "rhythm", label: "Rhythm"},
    {key: "musicianship", label: "Musicianship"},
    {key: "prepTime", label: "Utilization of Prep Time"},
  ],
};

module.exports = {
  COLLECTIONS,
  FIELDS,
  STATUSES,
  FORM_TYPES,
  JUDGE_POSITIONS,
  CAPTION_TEMPLATES,
};
