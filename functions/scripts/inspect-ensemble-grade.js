const admin = require("firebase-admin");

admin.initializeApp({projectId: "mpa-judge-v2"});

const db = admin.firestore();

async function main() {
  const schoolName = String(process.argv[2] || "").trim();
  const ensembleName = String(process.argv[3] || "").trim();
  if (!schoolName || !ensembleName) {
    throw new Error("Usage: node functions/scripts/inspect-ensemble-grade.js <schoolName> <ensembleName>");
  }

  const eventSnap = await db.collection("events").where("isActive", "==", true).limit(1).get();
  const eventId = eventSnap.docs[0]?.id || "";
  if (!eventId) {
    throw new Error("No active event.");
  }

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

  const entryRows = [];
  for (const row of scheduleRows) {
    const ensembleId = String(row.ensembleId || "").trim();
    if (!ensembleId) continue;
    const [entrySnapForEnsemble, ensembleSnap] = await Promise.all([
      db.collection("events").doc(eventId).collection("entries").doc(ensembleId).get(),
      db.collection("ensembles").doc(ensembleId).get(),
    ]);
    entryRows.push({
      ensembleId,
      entry: entrySnapForEnsemble.exists ? entrySnapForEnsemble.data() || {} : null,
      ensemble: ensembleSnap.exists ? ensembleSnap.data() || {} : null,
    });
  }

  console.log(JSON.stringify({
    eventId,
    scheduleRows: scheduleRows.map((row) => ({
      id: row.id,
      ensembleId: row.ensembleId || "",
      schoolName: row.schoolName || "",
      ensembleName: row.ensembleName || "",
      performanceGrade: row.performanceGrade || null,
      declaredGradeLevel: row.declaredGradeLevel || null,
    })),
    entryRows: entryRows.map((row) => ({
      ensembleId: row.ensembleId,
      entryPerformanceGrade: row.entry?.performanceGrade || null,
      entryDeclaredGradeLevel: row.entry?.declaredGradeLevel || null,
      ensemblePerformanceGrade: row.ensemble?.performanceGrade || null,
      ensembleDeclaredGradeLevel: row.ensemble?.declaredGradeLevel || null,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
