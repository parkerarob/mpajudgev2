#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-mpa-judge-v2}"
REGION="${REGION:-us-central1}"
RUNTIME="${RUNTIME:-nodejs22}"
SOURCE_DIR="${SOURCE_DIR:-functions}"

COMMON_FLAGS=(
  "--project=${PROJECT_ID}"
  "--region=${REGION}"
  "--runtime=${RUNTIME}"
  "--source=${SOURCE_DIR}"
  "--trigger-http"
  "--gen2"
  "--allow-unauthenticated"
  "--max-instances=10"
)

WITH_SECRET=(
  parseTranscript
  transcribeSubmissionAudio
  transcribePacketSession
  transcribePacketSegment
  transcribePacketTape
  transcribeTestAudio
)

WITHOUT_SECRET=(
  createOpenPacket
  setUserPrefs
  submitOpenPacket
  lockPacket
  unlockPacket
  releaseOpenPacket
  unreleaseOpenPacket
  linkOpenPacketToEnsemble
  setOpenPacketJudgePosition
  deleteOpenPacket
  releasePacket
  unreleasePacket
  unlockSubmission
  lockSubmission
  provisionUser
  deleteEnsemble
  renameEnsemble
  deleteSchool
  deleteEvent
)

echo "Deploying functions to project=${PROJECT_ID}, region=${REGION}, runtime=${RUNTIME}"

for fn in "${WITH_SECRET[@]}"; do
  echo "-> Deploying ${fn} (with OPENAI_API_KEY secret)"
  gcloud functions deploy "${fn}" \
    "${COMMON_FLAGS[@]}" \
    "--entry-point=${fn}" \
    "--set-secrets=OPENAI_API_KEY=OPENAI_API_KEY:latest"
done

for fn in "${WITHOUT_SECRET[@]}"; do
  echo "-> Deploying ${fn}"
  gcloud functions deploy "${fn}" \
    "${COMMON_FLAGS[@]}" \
    "--entry-point=${fn}" \
    "--clear-secrets"
done

echo "All function deploy commands completed."
