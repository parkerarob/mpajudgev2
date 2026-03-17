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

  return admin.auth().createUser({uid, email, password, displayName});
}

async function main() {
  const projectId =
    getArg("--project") ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "mpaapp-1";

  const gitEmail = getGitEmailFallback();
  const adminEmail =
    getArg("--admin-email") ||
    process.env.STAGING_ADMIN_EMAIL ||
    gitEmail ||
    "robert.parker@nhcs.net";
  const adminPassword =
    getArg("--admin-password") ||
    process.env.STAGING_ADMIN_PASSWORD ||
    "StageAdmin!2026";
  const adminName =
    getArg("--admin-name") ||
    process.env.STAGING_ADMIN_NAME ||
    "Rob Parker";

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
    email: "stage1@example.com",
    password: "password123",
    displayName: "Stage Judge 1",
  });
  const stage2 = await ensureUser({
    uid: "judge_stage2",
    email: "stage2@example.com",
    password: "password123",
    displayName: "Stage Judge 2",
  });
  const stage3 = await ensureUser({
    uid: "judge_stage3",
    email: "stage3@example.com",
    password: "password123",
    displayName: "Stage Judge 3",
  });
  const sight = await ensureUser({
    uid: "judge_sight",
    email: "sight@example.com",
    password: "password123",
    displayName: "Sight Judge",
  });
  const director = await ensureUser({
    uid: "director_001",
    email: "director@example.com",
    password: "password123",
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
  console.log("Judge login: stage1@example.com / password123");
  console.log("Director login: director@example.com / password123");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
