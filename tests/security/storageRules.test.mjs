import fs from "node:fs";
import path from "node:path";
import {beforeAll, afterAll, describe, it, expect} from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {doc, setDoc} from "firebase/firestore";
import {ref, uploadString} from "firebase/storage";

const PROJECT_ID = "mpa-judge-v2";

let testEnv;

async function seedFirestoreDocs() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "users/judge-1"), {
      role: "judge",
      schoolId: "school-1",
      roles: {judge: true},
    });
    await setDoc(doc(db, "users/judge-2"), {
      role: "judge",
      schoolId: "school-1",
      roles: {judge: true},
    });
    await setDoc(doc(db, "users/admin-1"), {
      role: "admin",
      roles: {admin: true},
    });

    await setDoc(doc(db, "submissions/submission-1"), {
      judgeUid: "judge-1",
      schoolId: "school-1",
      status: "submitted",
    });

    await setDoc(doc(db, "packets/packet-1"), {
      createdByJudgeUid: "judge-1",
      schoolId: "school-1",
      status: "draft",
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync(path.join(process.cwd(), "storage.rules"), "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });

  await seedFirestoreDocs();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("storage ownership bindings", () => {
  it("allows judge writes only when submission owner matches judge path UID", async () => {
    const ownCtx = testEnv.authenticatedContext("judge-1");
    const ownStorage = ownCtx.storage();
    const ownRef = ref(ownStorage, "audio/judge-1/submission-1/recording.webm");

    await assertSucceeds(uploadString(ownRef, "ok"));

    const mismatchCtx = testEnv.authenticatedContext("judge-2");
    const mismatchStorage = mismatchCtx.storage();
    const mismatchRef = ref(mismatchStorage, "audio/judge-2/submission-1/recording.webm");

    await assertFails(uploadString(mismatchRef, "nope"));
  });

  it("allows packet audio writes only when packet owner matches judge path UID", async () => {
    const ownCtx = testEnv.authenticatedContext("judge-1");
    const ownStorage = ownCtx.storage();
    const ownRef = ref(ownStorage, "packet_audio/judge-1/packet-1/session-1/master.webm");

    await assertSucceeds(uploadString(ownRef, "ok"));

    const mismatchCtx = testEnv.authenticatedContext("judge-2");
    const mismatchStorage = mismatchCtx.storage();
    const mismatchRef = ref(
      mismatchStorage,
      "packet_audio/judge-2/packet-1/session-1/master.webm",
    );

    await assertFails(uploadString(mismatchRef, "nope"));
  });

  it("keeps admin override write behavior", async () => {
    const adminCtx = testEnv.authenticatedContext("admin-1");
    const storage = adminCtx.storage();
    const writeRef = ref(storage, "audio/judge-2/submission-1/admin-fix.webm");

    const result = await assertSucceeds(uploadString(writeRef, "admin"));
    expect(result.metadata.fullPath).toContain("audio/judge-2/submission-1");
  });
});
