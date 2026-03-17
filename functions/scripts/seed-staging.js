const admin = require("firebase-admin");
const {execSync} = require("child_process");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function getGitEmailFallback() {
  try {
    return String(execSync("git config user.email", {encoding: "utf8"})).trim();
  } catch {
    return "";
  }
}

function sanitizeUidPart(value, fallback) {
  const cleaned = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

async function ensureUser({uid, email, password, displayName}) {
  try {
    const existing = await admin.auth().getUser(uid);
    await admin.auth().updateUser(uid, {email, password, displayName});
    return await admin.auth().getUser(existing.uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  if (email) {
    try {
      const existingByEmail = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(existingByEmail.uid, {password, displayName});
      return await admin.auth().getUser(existingByEmail.uid);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }

  return admin.auth().createUser({uid, email, password, displayName});
}

async function main() {
  const projectId =
    getArg("--project") ||
    process.env.STAGING_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error("Staging seed requires --project or STAGING_PROJECT_ID.");
  }

  const protectedProjects = new Set(["mpa-judge-v2", "mpaapp-1"]);
  const allowProtectedProject =
    getArg("--allow-protected-project") === "true" ||
    String(process.env.ALLOW_PROTECTED_PROJECT || "").trim().toLowerCase() === "true";
  if (protectedProjects.has(projectId) && !allowProtectedProject) {
    throw new Error(
        `Refusing to seed protected project ${projectId}. ` +
        "Set ALLOW_PROTECTED_PROJECT=true only if you intentionally want that target.",
    );
  }

  const gitEmail = getGitEmailFallback();
  const adminEmail =
    getArg("--admin-email") ||
    process.env.STAGING_ADMIN_EMAIL ||
    gitEmail;
  if (!adminEmail) {
    throw new Error("Staging seed requires --admin-email or STAGING_ADMIN_EMAIL.");
  }
  const adminPassword =
    getArg("--admin-password") ||
    process.env.STAGING_ADMIN_PASSWORD;
  const sharedPassword =
    getArg("--shared-password") ||
    process.env.STAGING_SHARED_PASSWORD;
  if (!adminPassword || !sharedPassword) {
    throw new Error(
        "Staging seed requires STAGING_ADMIN_PASSWORD and STAGING_SHARED_PASSWORD " +
        "(or --admin-password / --shared-password).",
    );
  }
  const adminName =
    getArg("--admin-name") ||
    process.env.STAGING_ADMIN_NAME ||
    "Rob Parker";
  const emailSuffix = `${sanitizeUidPart(projectId, "staging")}.local`;

  admin.initializeApp({projectId});
  const db = admin.firestore();

  const eventId = "event_2026_1";
  const schoolId = "school_001";
  const ensembleId = "ensemble_001";

  const adminUid = `admin_${sanitizeUidPart(adminEmail.split("@")[0], "robert_parker")}`;
  const adminUser = await ensureUser({
    uid: adminUid,
    email: adminEmail,
    password: adminPassword,
    displayName: adminName,
  });

  const stage1 = await ensureUser({
    uid: "judge_stage1",
    email: `stage1@${emailSuffix}`,
    password: sharedPassword,
    displayName: "Stage Judge 1",
  });
  const stage2 = await ensureUser({
    uid: "judge_stage2",
    email: `stage2@${emailSuffix}`,
    password: sharedPassword,
    displayName: "Stage Judge 2",
  });
  const stage3 = await ensureUser({
    uid: "judge_stage3",
    email: `stage3@${emailSuffix}`,
    password: sharedPassword,
    displayName: "Stage Judge 3",
  });
  const sight = await ensureUser({
    uid: "judge_sight",
    email: `sight@${emailSuffix}`,
    password: sharedPassword,
    displayName: "Sight Judge",
  });
  const director = await ensureUser({
    uid: "director_001",
    email: `director@${emailSuffix}`,
    password: sharedPassword,
    displayName: "Director One",
  });

  await db.collection("users").doc(adminUser.uid).set({
    role: "admin",
    roles: {admin: true, judge: false, director: false, teamLead: false},
    email: adminUser.email,
    displayName: adminUser.displayName,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  const judgeDocs = [stage1, stage2, stage3, sight];
  await Promise.all(
      judgeDocs.map((judge) =>
        db.collection("users").doc(judge.uid).set({
          role: "judge",
          roles: {admin: false, judge: true, director: false, teamLead: false},
          email: judge.email,
          displayName: judge.displayName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true}),
      ),
  );

  await db.collection("users").doc(director.uid).set({
    role: "director",
    roles: {admin: false, judge: false, director: true, teamLead: false},
    email: director.email,
    displayName: director.displayName,
    schoolId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  await db.collection("schools").doc(schoolId).set({
    name: "Central High",
    directors: {
      [director.uid]: true,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  const ensembleSeed = {
    schoolId,
    name: "Central Wind Ensemble",
    performanceGrade: "II",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("ensembles").doc(ensembleId).set(ensembleSeed, {merge: true});
  await db
      .collection("schools")
      .doc(schoolId)
      .collection("ensembles")
      .doc(ensembleId)
      .set(ensembleSeed, {merge: true});

  await db.collection("events").doc(eventId).set({
    name: "MPA Regional 2026",
    isActive: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  await db
      .collection("events")
      .doc(eventId)
      .collection("schedule")
      .doc("slot_001")
      .set({
        orderIndex: 1,
        stageTime: "10:30 AM",
        schoolId,
        ensembleId,
        schoolName: "Central High",
        ensembleName: "Central Wind Ensemble",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

  await db
      .collection("events")
      .doc(eventId)
      .collection("assignments")
      .doc("positions")
      .set({
        stage1Uid: stage1.uid,
        stage2Uid: stage2.uid,
        stage3Uid: stage3.uid,
        sightUid: sight.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

  console.log(`Seeded staging project ${projectId}`);
  console.log(`Admin login: ${adminEmail}`);
  console.log(`Admin password: ${adminPassword}`);
  console.log(`Judge login: ${stage1.email} / ${sharedPassword}`);
  console.log(`Director login: ${director.email} / ${sharedPassword}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
