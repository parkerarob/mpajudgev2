const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
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
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      const rounded = Math.trunc(num);
      if (String(rounded).length === 4) return rounded;
    }
  }
  if (/^\d{4}$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function normalizeHeaderKey(value) {
  return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
}

function getCell(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function parseWorkbookXlsx(filePath) {
  const workbook = XLSX.readFile(filePath, {cellDates: false});
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: ""});
  if (!rows.length) return [];

  let headerRowIndex = rows.findIndex((row) => Array.isArray(row) &&
    row.some((cell) => normalizeHeaderKey(cell) === "grade") &&
    row.some((cell) => normalizeHeaderKey(cell).includes("title")) &&
    row.some((cell) => normalizeHeaderKey(cell).includes("composer")));
  if (headerRowIndex < 0) headerRowIndex = 0;

  const rawHeaders = rows[headerRowIndex].map(normalizeHeaderKey);
  const entries = [];
  for (const row of rows.slice(headerRowIndex + 1)) {
    if (!Array.isArray(row)) continue;
    const mapped = {};
    rawHeaders.forEach((header, index) => {
      if (!header) return;
      mapped[header] = row[index];
    });
    const grade = normalizeWhitespace(getCell(mapped, "grade"));
    const title = normalizeWhitespace(getCell(mapped, "title"));
    const composer = normalizeWhitespace(getCell(mapped, "composer"));
    if (!grade || !title) continue;
    const specialInstructions = normalizeWhitespace(getCell(
        mapped,
        "special instructions",
        "special instruction",
    ));
    const status = normalizeWhitespace(getCell(mapped, "status"));
    const composerInto = normalizeWhitespace(getCell(mapped, "composer into"));
    const combinedSpecial = normalizeWhitespace(`${specialInstructions} ${composerInto}`);
    const entry = {
      grade,
      title,
      composer,
      distributorPublisher: normalizeWhitespace(getCell(
          mapped,
          "distributor publisher",
          "distributor - publisher",
      )),
      status,
      supplierItemNo: normalizeWhitespace(getCell(
          mapped,
          "supplier id item no",
          "supplier id item no.",
          "supplier item no",
      )),
      yearAdded: getCell(mapped, "year added"),
      specialInstructions: combinedSpecial,
    };
    entry.tags = extractTags(entry);
    entries.push(entry);
  }
  return entries;
}

async function main() {
  const xlsxPathArg = getArg("--xlsx") || process.env.MPA_XLSX_PATH;
  const pdfPathArg = getArg("--pdf") || process.env.MPA_PDF_PATH;
  if (!xlsxPathArg && !pdfPathArg) {
    console.error("Missing source path. Use --xlsx \"/path/to/list.xlsx\" or --pdf \"/path/to/NCBA_MPA_List.pdf\".");
    process.exit(1);
  }

  const projectId =
    getArg("--project") ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "mpa-judge-v2";

  admin.initializeApp({projectId});
  const db = admin.firestore();

  let parsedEntries = [];
  if (xlsxPathArg) {
    const xlsxPath = path.resolve(xlsxPathArg);
    if (!fs.existsSync(xlsxPath)) {
      console.error(`XLSX not found at ${xlsxPath}`);
      process.exit(1);
    }
    parsedEntries = parseWorkbookXlsx(xlsxPath);
  } else {
    const pdfPath = path.resolve(pdfPathArg);
    if (!fs.existsSync(pdfPath)) {
      console.error(`PDF not found at ${pdfPath}`);
      process.exit(1);
    }
    const buffer = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(buffer);
    const lines = parsed.text.split(/\r?\n/);
    parsedEntries = parseLines(lines);
  }

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
