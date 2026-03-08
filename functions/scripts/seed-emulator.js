const admin = require("firebase-admin");

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "mpa-judge-v2";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";

admin.initializeApp({projectId});

const db = admin.firestore();
const auth = admin.auth();

async function ensureUser({uid, email, password, displayName}) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  return auth.createUser({uid, email, password, displayName});
}

async function main() {
  const eventId = "event_2026_1";
  const schoolId = "school_001";
  const ensembleId = "ensemble_001";

  const adminUser = await ensureUser({
    uid: "admin_001",
    email: "admin@example.com",
    password: "password123",
    displayName: "Admin User",
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
    email: adminUser.email,
    displayName: adminUser.displayName,
  });

  const judgeDocs = [stage1, stage2, stage3, sight];
  await Promise.all(
      judgeDocs.map((judge) =>
        db.collection("users").doc(judge.uid).set({
          role: "judge",
          email: judge.email,
          displayName: judge.displayName,
        }),
      ),
  );

  await db.collection("users").doc(director.uid).set({
    role: "director",
    email: director.email,
    displayName: director.displayName,
    schoolId,
  });

  await db.collection("schools").doc(schoolId).set({
    name: "Central High",
    directors: {
      [director.uid]: true,
    },
  });

  await db.collection("ensembles").doc(ensembleId).set({
    schoolId,
    name: "Central Wind Ensemble",
    performanceGrade: "II",
  });

  await db.collection("events").doc(eventId).set({
    name: "MPA Regional 2026",
    isActive: true,
  });

  await db
      .collection("events")
      .doc(eventId)
      .collection("schedule")
      .add({
        orderIndex: 1,
        stageTime: "10:30 AM",
        schoolId,
        ensembleId,
      });

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
      });

  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
