const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const admin = require("firebase-admin");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  const normalized = normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return normalized;
}

function buildDocId({grade, title, composer}) {
  const base = `${grade}|${title}|${composer}`.toLowerCase();
  const hash = crypto.createHash("sha1").update(base).digest("hex").slice(0, 12);
  const titleSlug = slugify(title).slice(0, 40) || "title";
  const composerSlug = slugify(composer).slice(0, 30) || "composer";
  return `${grade}_${titleSlug}_${composerSlug}_${hash}`;
}

function extractTags({specialInstructions, status}) {
  const tags = new Set();
  const haystack = `${specialInstructions || ""} ${status || ""}`.toLowerCase();
  if (haystack.includes("underrepresented")) tags.add("Underrepresented");
  const hasNcComposerArranger =
      haystack.includes("nc composer/arranger") ||
      haystack.includes("nc composer and arranger");
  if (hasNcComposerArranger) {
    tags.add("NC Composer/Arranger");
  } else if (haystack.includes("nc composer")) {
    tags.add("NC Composer");
  }
  return Array.from(tags);
}

function parseLines(lines) {
  const entries = [];
  let current = null;
  const gradePattern = /^(VI|IV|V|III|II|I)\b/;

  lines.forEach((rawLine) => {
    const raw = String(rawLine || "");
    const trimmed = raw.trim();
    if (!trimmed) return;
    const gradeMatch = trimmed.match(gradePattern);
    if (gradeMatch) {
      if (current && current.title) {
        entries.push(current);
      }
      const grade = gradeMatch[1];
      const restRaw = trimmed.slice(gradeMatch[0].length).trim();
      const columns = restRaw.split(/\s{2,}/).map(normalizeWhitespace).filter(Boolean);
      const [
        title,
        composer,
        distributorPublisher,
        status,
        supplierItemNo,
        yearAdded,
        ...extra
      ] = columns;
      const specialInstructions = normalizeWhitespace(extra.join(" "));
      current = {
        grade,
        title: title || "",
        composer: composer || "",
        distributorPublisher: distributorPublisher || "",
        status: status || "",
        supplierItemNo: supplierItemNo || "",
        yearAdded: yearAdded || "",
        specialInstructions,
      };
      current.tags = extractTags(current);
      return;
    }

    if (current) {
      current.specialInstructions = normalizeWhitespace(
          `${current.specialInstructions || ""} ${trimmed}`,
      );
    }
  });

  if (current && current.title) {
    entries.push(current);
  }

  return entries;
}

function normalizeYear(value) {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return "";
  if (/^\d{4}$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

async function main() {
  const pdfPathArg = getArg("--pdf") || process.env.MPA_PDF_PATH;
  if (!pdfPathArg) {
    console.error("Missing PDF path. Use --pdf \"/path/to/NCBA_MPA_List.pdf\".");
    process.exit(1);
  }

  const pdfPath = path.resolve(pdfPathArg);
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found at ${pdfPath}`);
    process.exit(1);
  }

  const projectId =
    getArg("--project") ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "mpa-judge-v2";

  admin.initializeApp({projectId});
  const db = admin.firestore();

  const buffer = fs.readFileSync(pdfPath);
  const parsed = await pdfParse(buffer);
  const lines = parsed.text.split(/\r?\n/);
  const parsedEntries = parseLines(lines);

  const deduped = [];
  const seen = new Set();
  parsedEntries.forEach((entry) => {
    const key = `${entry.grade}|${entry.title}|${entry.composer}`.toLowerCase();
    if (!entry.title) return;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });

  let batch = db.batch();
  let batchCount = 0;
  let writeCount = 0;
  for (const entry of deduped) {
    const docRef = db.collection("mpaRepertoire").doc(buildDocId(entry));
    const title = normalizeWhitespace(entry.title);
    const composer = normalizeWhitespace(entry.composer);
    const doc = {
      grade: entry.grade,
      title,
      titleLower: title.toLowerCase(),
      composer,
      composerLower: composer.toLowerCase(),
      distributorPublisher: normalizeWhitespace(entry.distributorPublisher),
      specialInstructions: normalizeWhitespace(entry.specialInstructions),
      status: normalizeWhitespace(entry.status),
      supplierItemNo: normalizeWhitespace(entry.supplierItemNo),
      yearAdded: normalizeYear(entry.yearAdded),
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    };
    batch.set(docRef, doc);
    batchCount += 1;
    writeCount += 1;
    if (batchCount >= 500) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) {
    await batch.commit();
  }

  const summary = `Seed complete. Parsed ${parsedEntries.length} lines, writing ${writeCount} entries.`;
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
