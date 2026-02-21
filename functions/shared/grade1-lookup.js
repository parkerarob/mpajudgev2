(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GradeOneLookup = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const GRADE_ONE_MAP = {
    111: "I",
    112: "I",
    113: "I",
    114: "I",
    115: "I",
    122: "II",
    123: "II",
    222: "II",
    223: "II",
    224: "II",
    225: "II",
    133: "III",
    234: "III",
    332: "III",
    333: "III",
    334: "III",
    335: "III",
    144: "IV",
    345: "IV",
    442: "IV",
    443: "IV",
    444: "IV",
    445: "IV",
    155: "V",
    255: "V",
    355: "V",
    455: "V",
    555: "V",
  };

  function computeGradeOneKey(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.join("");
  }

  return { GRADE_ONE_MAP, computeGradeOneKey };
});
