const COLLECTIONS = {
  users: "users",
  schools: "schools",
  events: "events",
  schedule: "schedule",
  assignments: "assignments",
  submissions: "submissions",
  ensembles: "ensembles",
};

const FIELDS = {
  users: {
    role: "role",
    schoolId: "schoolId",
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
};

const STATUSES = {
  submitted: "submitted",
  released: "released",
};

const FORM_TYPES = {
  stage: "stage",
  sight: "sight",
};

const CAPTION_TEMPLATES = {
  stage: [
    { key: "toneQuality", label: "Tone Quality" },
    { key: "intonation", label: "Intonation" },
    { key: "rhythm", label: "Rhythm & Precision" },
    { key: "balanceBlend", label: "Balance & Blend" },
    { key: "expression", label: "Expression" },
    { key: "technique", label: "Technique" },
    { key: "musicianship", label: "Musicianship" },
  ],
  sight: [
    { key: "accuracy", label: "Accuracy" },
    { key: "rhythm", label: "Rhythm & Pulse" },
    { key: "toneQuality", label: "Tone Quality" },
    { key: "balanceBlend", label: "Balance & Blend" },
    { key: "expression", label: "Expression" },
    { key: "musicianship", label: "Musicianship" },
    { key: "sightReading", label: "Sight Reading Fundamentals" },
  ],
};

module.exports = {
  COLLECTIONS,
  FIELDS,
  STATUSES,
  FORM_TYPES,
  CAPTION_TEMPLATES,
};
