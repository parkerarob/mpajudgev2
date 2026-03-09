export function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function romanToLevel(roman) {
  const map = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return map[roman] || null;
}

export function levelToRoman(level) {
  const map = ["I", "II", "III", "IV", "V", "VI"];
  return map[level - 1] || "";
}

export function derivePerformanceGrade(gradeA, gradeB) {
  const a = Number(gradeA || 0);
  const b = Number(gradeB || 0);
  if (!a || !b) return { ok: false, error: "Select grades for both selections." };
  if (a === b) {
    const roman = levelToRoman(a);
    return { ok: true, value: roman };
  }
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (max - min !== 1) {
    return {
      ok: false,
      error: "Grades must match or be adjacent (I/II, II/III, III/IV, IV/V, V/VI).",
    };
  }
  return { ok: true, value: `${levelToRoman(min)}/${levelToRoman(max)}` };
}

export function ensureArrayLength(arr, length, factory) {
  const next = Array.isArray(arr) ? [...arr] : [];
  while (next.length < length) {
    next.push(factory());
  }
  return next.slice(0, length);
}

export function setValueAtPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const key = Number.isNaN(Number(part)) ? part : Number(part);
    if (isLast) {
      current[key] = value;
      return;
    }
    if (current[key] == null) {
      const nextKey = parts[index + 1];
      const nextIsNumber = !Number.isNaN(Number(nextKey));
      current[key] = nextIsNumber ? [] : {};
    }
    current = current[key];
  });
}

export function getValueAtPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    const key = Number.isNaN(Number(part)) ? part : Number(part);
    current = current[key];
  }
  return current;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result || "";
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function getEventLabel(event) {
  if (!event) return "Unknown event";
  return `${event.name || "Event"} (${event.id})`;
}

export function getEventCardLabel(event) {
  if (!event) return "Unknown event";
  return event.name || "Event";
}

export function normalizeGrade(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  if (roman.includes(text)) return text;
  const num = Number(text);
  if (!Number.isNaN(num) && num >= 1 && num <= 6) return roman[num - 1];
  return null;
}

function normalizeGradeToken(token) {
  return normalizeGrade(String(token || "").trim());
}

/**
 * Normalize a grade value that may be a single level (e.g. "III")
 * or adjacent range (e.g. "II/III", "2/3", "II-III").
 *
 * Returns canonical Roman form ("III" or "II/III") or null.
 */
export function normalizeGradeBand(value) {
  if (!value) return null;
  const text = String(value)
    .trim()
    .toUpperCase()
    .replace(/[–—-]+/g, "/")
    .replace(/\s+/g, "");
  if (!text) return null;
  if (!text.includes("/")) {
    return normalizeGradeToken(text);
  }
  const parts = text.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const left = normalizeGradeToken(parts[0]);
  const right = normalizeGradeToken(parts[1]);
  if (!left || !right) return null;
  const leftLevel = romanToLevel(left);
  const rightLevel = romanToLevel(right);
  if (!leftLevel || !rightLevel) return null;
  const min = Math.min(leftLevel, rightLevel);
  const max = Math.max(leftLevel, rightLevel);
  if (max - min !== 1) return null;
  return `${levelToRoman(min)}/${levelToRoman(max)}`;
}

export function mapOverallLabelFromTotal(total) {
  if (total >= 4 && total <= 6) return "I";
  if (total >= 7 && total <= 10) return "II";
  if (total >= 11 && total <= 14) return "III";
  if (total >= 15 && total <= 18) return "IV";
  if (total >= 19 && total <= 20) return "V";
  return "N/A";
}

export function toDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value?.toDate) {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  if (value?.toMillis) {
    const parsed = new Date(value.toMillis());
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const secondsCandidate = value.seconds ?? value._seconds;
    const nanosCandidate = value.nanoseconds ?? value._nanoseconds ?? 0;
    if (Number.isFinite(Number(secondsCandidate))) {
      const ms = (Number(secondsCandidate) * 1000) + Math.floor(Number(nanosCandidate) / 1e6);
      const parsed = new Date(ms);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatPerformanceAt(value) {
  const date = toDateLike(value);
  if (!date) return "";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateHeading(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getSchoolNameById(schoolsList, schoolId) {
  const list = Array.isArray(schoolsList) ? schoolsList : [];
  const match = list.find((school) => school.id === schoolId);
  return match?.name || schoolId || "Unknown";
}

function canonicalizeSchoolText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function schoolPrefixVariants(schoolName) {
  const base = canonicalizeSchoolText(schoolName);
  if (!base) return [];
  const variants = new Set([base]);

  const withoutSchool = base.replace(/\bschool\b/g, "").replace(/\s+/g, " ").trim();
  if (withoutSchool) variants.add(withoutSchool);

  const shortForms = [
    [/\bhigh school\b/g, "hs"],
    [/\bmiddle school\b/g, "ms"],
    [/\belementary school\b/g, "es"],
  ];
  shortForms.forEach(([pattern, replacement]) => {
    const next = base.replace(pattern, replacement).replace(/\s+/g, " ").trim();
    if (next) variants.add(next);
  });

  const descriptorTokens = new Set(["school", "high", "middle", "elementary", "hs", "ms", "es"]);
  const seedVariants = Array.from(variants);
  seedVariants.forEach((seed) => {
    const tokens = seed.split(" ").filter(Boolean);
    while (tokens.length > 1 && descriptorTokens.has(tokens[tokens.length - 1])) {
      tokens.pop();
      const next = tokens.join(" ").trim();
      if (next) variants.add(next);
    }
  });

  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

export function normalizeEnsembleNameForSchool({ schoolName, ensembleName }) {
  const finalizeName = (value) => {
    const text = String(value || "").trim();
    const canonical = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    return canonical === "band" ? "Concert Band" : text;
  };
  const original = String(ensembleName || "").trim();
  if (!original) return "";
  const variants = schoolPrefixVariants(schoolName);
  if (!variants.length) return finalizeName(original);

  const compactName = original
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const matched = variants.find((variant) => compactName === variant || compactName.startsWith(`${variant} `));
  if (!matched) return finalizeName(original);

  const tokens = matched.split(" ").filter(Boolean);
  const sourceTokens = original.split(/\s+/);
  let sourceIdx = 0;
  let matchIdx = 0;
  while (sourceIdx < sourceTokens.length && matchIdx < tokens.length) {
    const token = sourceTokens[sourceIdx];
    const canonical = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = tokens[matchIdx].replace(/[^a-z0-9]/g, "");
    if (!canonical) {
      sourceIdx += 1;
      continue;
    }
    if (canonical === target) {
      sourceIdx += 1;
      matchIdx += 1;
      continue;
    }
    return finalizeName(original);
  }
  if (matchIdx !== tokens.length) return finalizeName(original);

  const remainder = sourceTokens
    .slice(sourceIdx)
    .join(" ")
    .replace(/^[\s\-:|/]+/, "")
    .trim();
  return finalizeName(remainder || original);
}

export function normalizeCaptions(formType, captions = {}) {
  const source = captions || {};
  const stageMap = {
    toneQuality: "toneQuality",
    intonation: "intonation",
    balanceBlend: "balanceBlend",
    precision: "precision",
    basicMusicianship: "basicMusicianship",
    interpretativeMusicianship: "interpretativeMusicianship",
    generalFactors: "generalFactors",
    rhythm: "precision",
    expression: "interpretativeMusicianship",
    technique: "basicMusicianship",
    musicianship: "generalFactors",
  };
  const sightMap = {
    toneQuality: "toneQuality",
    intonation: "intonation",
    balance: "balance",
    technique: "technique",
    rhythm: "rhythm",
    musicianship: "musicianship",
    prepTime: "prepTime",
    balanceBlend: "balance",
    accuracy: "technique",
    expression: "musicianship",
    sightReading: "prepTime",
  };
  const map = formType === "sight" ? sightMap : stageMap;
  const normalized = {};
  Object.keys(source).forEach((key) => {
    const targetKey = map[key];
    if (!targetKey) return;
    if (normalized[targetKey]) return;
    normalized[targetKey] = source[key];
  });
  return normalized;
}
