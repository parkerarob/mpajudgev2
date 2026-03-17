import fs from "node:fs";
import path from "node:path";
import {describe, it, expect} from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "functions/index.js"), "utf8");

function getExportBlock(functionName) {
  const start = source.indexOf(`exports.${functionName} = onCall`);
  if (start < 0) throw new Error(`Missing callable export: ${functionName}`);
  const nextExport = source.indexOf("\nexports.", start + 1);
  return nextExport < 0 ? source.slice(start) : source.slice(start, nextExport);
}

describe("callable auth contract coverage", () => {
  it("getDirectorAudioResultAsset enforces auth, role, school, and release status", () => {
    const block = getExportBlock("getDirectorAudioResultAsset");
    expect(block).toContain("Authentication required.");
    expect(block).toContain('role !== "director"');
    expect(block).toContain("Not authorized for this school.");
    expect(block).toContain("Audio result is not released.");
  });

  it("getDirectorPacketAssets enforces auth, role, school, and ready-status semantics", () => {
    const block = getExportBlock("getDirectorPacketAssets");
    expect(block).toContain("Authentication required.");
    expect(block).toContain('role !== "director"');
    expect(block).toContain("Not authorized for this school.");
    expect(block).toContain('String(exportData.status || "") !== "ready"');
  });

  it("release/unrelease and lock/unlock critical transitions require ops lead", () => {
    const releaseBlock = getExportBlock("releasePacket");
    const unreleaseBlock = getExportBlock("unreleasePacket");
    const lockBlock = getExportBlock("lockSubmission");
    const unlockBlock = getExportBlock("unlockSubmission");

    expect(releaseBlock).toContain("await assertOpsLead(request)");
    expect(unreleaseBlock).toContain("await assertOpsLead(request)");
    expect(lockBlock).toContain("await assertOpsLead(request)");
    expect(unlockBlock).toContain("await assertOpsLead(request)");
  });

  it("repairDirectorEntrySchoolMismatch enforces auth and director/admin access", () => {
    const block = getExportBlock("repairDirectorEntrySchoolMismatch");
    expect(block).toContain("Authentication required.");
    expect(block).toContain("eventId and ensembleId are required.");
    expect(block).toContain("Director or admin access required.");
    expect(block).toContain("Director is not attached to a school.");
  });

  it("raw assessment admin transitions require ops lead and explicit identifiers", () => {
    const officializeBlock = getExportBlock("officializeRawAssessment");
    const excludeBlock = getExportBlock("excludeRawAssessment");
    const reassignBlock = getExportBlock("reassignRawAssessment");

    expect(officializeBlock).toContain("await assertOpsLead(request)");
    expect(officializeBlock).toContain("rawAssessmentId, eventId, ensembleId, and judgePosition are required.");
    expect(excludeBlock).toContain("await assertOpsLead(request)");
    expect(excludeBlock).toContain("rawAssessmentId is required.");
    expect(reassignBlock).toContain("await assertOpsLead(request)");
    expect(reassignBlock).toContain("rawAssessmentId, eventId, ensembleId, and judgePosition are required.");
  });

  it("submitOpenPacket now persists raw assessments instead of writing official submissions directly", () => {
    const block = getExportBlock("submitOpenPacket");
    expect(block).toContain("COLLECTIONS.rawAssessments");
    expect(block).toContain("FIELDS.rawAssessments.status");
    expect(block).not.toContain("tx.set(submissionRef");
  });
});
