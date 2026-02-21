const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  FORM_TYPES,
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
