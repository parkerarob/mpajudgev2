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

export function mapOverallLabelFromTotal(total) {
  if (total >= 4 && total <= 6) return "I";
  if (total >= 7 && total <= 10) return "II";
  if (total >= 11 && total <= 14) return "III";
  if (total >= 15 && total <= 18) return "IV";
  if (total >= 19 && total <= 20) return "V";
  return "N/A";
}

export function formatPerformanceAt(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
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
