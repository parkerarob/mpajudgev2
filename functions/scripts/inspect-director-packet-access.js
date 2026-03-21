const admin = require("firebase-admin");

admin.initializeApp({projectId: "mpa-judge-v2"});

const db = admin.firestore();

async function main() {
  const schoolName = String(process.argv[2] || "").trim();
  const ensembleName = String(process.argv[3] || "").trim();
  if (!schoolName || !ensembleName) {
    throw new Error("Usage: node functions/scripts/inspect-director-packet-access.js <schoolName> <ensembleName>");
  }

  const activeSnap = await db.collection("events").where("isActive", "==", true).limit(1).get();
  const eventId = activeSnap.docs[0]?.id || "";
  if (!eventId) {
    throw new Error("No active event.");
  }

  const schoolsSnap = await db.collection("schools").where("name", "==", schoolName).limit(5).get();
  const schoolRows = schoolsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
  const schoolId = String(schoolRows[0]?.id || "").trim();

  const scheduleSnap = await db
      .collection("events")
      .doc(eventId)
      .collection("schedule")
      .where("schoolName", "==", schoolName)
      .where("ensembleName", "==", ensembleName)
      .limit(5)
      .get();
  const scheduleRows = scheduleSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
  const ensembleId = String(scheduleRows[0]?.ensembleId || "").trim();

  const entrySnap = ensembleId ?
    await db.collection("events").doc(eventId).collection("entries").doc(ensembleId).get() :
    null;
  const ensembleSnap = ensembleId ?
    await db.collection("ensembles").doc(ensembleId).get() :
    null;
  const exportSnap = ensembleId ?
    await db.collection("packetExports").doc(`${eventId}_${ensembleId}`).get() :
    null;

  const usersSnap = schoolId ?
    await db.collection("users").where("schoolId", "==", schoolId).limit(20).get() :
    {docs: []};
  const usersForSchool = usersSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  const positions = ["stage1", "stage2", "stage3", "sight"];
  const canonicalIds = ensembleId ? positions.map((position) => `${eventId}_${ensembleId}_${position}`) : [];
  const submissionSnaps = canonicalIds.length ?
    await db.getAll(...canonicalIds.map((id) => db.collection("submissions").doc(id))) :
    [];
  const officialSnaps = canonicalIds.length ?
    await db.getAll(...canonicalIds.map((id) => db.collection("officialAssessments").doc(id))) :
    [];

  console.log(JSON.stringify({
    eventId,
    schoolId,
    ensembleId,
    schools: schoolRows.map((row) => ({
      id: row.id,
      name: row.name || "",
      directorUid: row.directorUid || "",
      directorName: row.directorName || "",
    })),
    schedule: scheduleRows.map((row) => ({
      id: row.id,
      schoolId: row.schoolId || "",
      schoolName: row.schoolName || "",
      ensembleId: row.ensembleId || "",
      ensembleName: row.ensembleName || "",
      performanceGrade: row.performanceGrade || null,
      declaredGradeLevel: row.declaredGradeLevel || null,
    })),
    entry: entrySnap?.exists ? {id: entrySnap.id, ...entrySnap.data()} : null,
    ensemble: ensembleSnap?.exists ? {id: ensembleSnap.id, ...ensembleSnap.data()} : null,
    packetExport: exportSnap?.exists ? {id: exportSnap.id, ...exportSnap.data()} : null,
    usersForSchool: usersForSchool.map((row) => ({
      id: row.id,
      email: row.email || "",
      role: row.role || "",
      schoolId: row.schoolId || "",
      displayName: row.displayName || row.name || "",
    })),
    submissions: submissionSnaps.map((snap, index) => ({
      id: canonicalIds[index],
      exists: snap.exists,
      ...(snap.exists ? snap.data() : {}),
    })),
    officialAssessments: officialSnaps.map((snap, index) => ({
      id: canonicalIds[index],
      exists: snap.exists,
      ...(snap.exists ? snap.data() : {}),
    })),
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
