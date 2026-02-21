const assert = (condition, message) => {
  if (!condition) {
    console.error(`Grade I lookup test failed: ${message}`);
    process.exit(1);
  }
};

const { GRADE_ONE_MAP, computeGradeOneKey } = require("../shared/grade1-lookup");

const expected = {
  I: ["111", "112", "113", "114", "115"],
  II: ["122", "123", "222", "223", "224", "225"],
  III: ["133", "234", "332", "333", "334", "335"],
  IV: ["144", "345", "442", "443", "444", "445"],
  V: ["155", "255", "355", "455", "555"],
};

const allExpected = Object.values(expected).flat();

assert(
  Object.keys(GRADE_ONE_MAP).length === 28,
  `Expected 28 keys, got ${Object.keys(GRADE_ONE_MAP).length}.`
);

allExpected.forEach((key) => {
  const label = GRADE_ONE_MAP[key];
  const expectedLabel = Object.entries(expected).find(([, keys]) =>
    keys.includes(key)
  )?.[0];
  assert(
    label === expectedLabel,
    `Key ${key} expected ${expectedLabel}, got ${label}.`
  );
});

const permutations = [
  { values: [3, 2, 1], expected: "II" },
  { values: [5, 4, 3], expected: "IV" },
  { values: [2, 2, 5], expected: "II" },
];

permutations.forEach(({ values, expected: expectedLabel }) => {
  const key = computeGradeOneKey(values);
  const label = GRADE_ONE_MAP[key];
  assert(
    label === expectedLabel,
    `Permutation ${values.join("")} resolved to ${key} -> ${label}, expected ${expectedLabel}.`
  );
});

console.log("Grade I lookup tests passed.");
