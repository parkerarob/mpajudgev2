export function createAdminMockPacketPreviewRenderer({
  els,
  JUDGE_POSITIONS,
  JUDGE_POSITION_LABELS,
  FORM_TYPES,
  CAPTION_TEMPLATES,
  STATUSES,
  calculateCaptionTotal,
  computeFinalRating,
  levelToRoman,
  renderSubmissionCard,
} = {}) {
  function buildMockPacketCaptions(formType, judgeLabel) {
    const template = CAPTION_TEMPLATES[formType] || CAPTION_TEMPLATES.stage || [];
    const gradeCycle = ["A", "A", "B", "A", "B", "A", "B"];
    const captions = {};
    template.forEach((item, index) => {
      captions[item.key] = {
        gradeLetter: gradeCycle[index % gradeCycle.length],
        gradeModifier: index % 3 === 0 ? "+" : "",
        comment: `${judgeLabel}: ${item.label} is consistent with strong clarity, balance, and musical intent.`,
      };
    });
    return captions;
  }

  function buildMockPacketSubmission(position) {
    const formType = position === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
    const judgeLabel = JUDGE_POSITION_LABELS[position] || "Judge";
    const captions = buildMockPacketCaptions(formType, judgeLabel);
    const captionScoreTotal = calculateCaptionTotal(captions);
    const rating = computeFinalRating(captionScoreTotal);
    return {
      status: STATUSES.locked,
      formType,
      locked: true,
      judgeName: `${judgeLabel} Mock Judge`,
      judgeEmail: `${position}@mock.mpa`,
      judgeTitle: "Judge",
      judgeAffiliation: "NCBA Mock Panel",
      transcript:
        `${judgeLabel} mock transcript: consistent tone quality, rhythmic clarity, and ensemble balance with minor precision adjustments noted.`,
      captions,
      captionScoreTotal,
      computedFinalRatingLabel: rating.label,
    };
  }

  function renderMockAdminPacketPreview() {
    if (!els.adminPacketsMockPanel) return;
    const submissions = {
      [JUDGE_POSITIONS.stage1]: buildMockPacketSubmission(JUDGE_POSITIONS.stage1),
      [JUDGE_POSITIONS.stage2]: buildMockPacketSubmission(JUDGE_POSITIONS.stage2),
      [JUDGE_POSITIONS.stage3]: buildMockPacketSubmission(JUDGE_POSITIONS.stage3),
      [JUDGE_POSITIONS.sight]: buildMockPacketSubmission(JUDGE_POSITIONS.sight),
    };

    const ratingValues = Object.values(submissions)
      .map((sub) => computeFinalRating(Number(sub.captionScoreTotal || 0)).value)
      .filter((value) => Number.isFinite(value));
    const avgValue = ratingValues.length
      ? Math.max(1, Math.min(5, Math.round(ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length)))
      : null;
    const overallLabel = avgValue ? levelToRoman(avgValue) : "N/A";

    els.adminPacketsMockPanel.innerHTML = "";
    const mockBadge = document.createElement("span");
    mockBadge.className = "badge";
    mockBadge.textContent = "Mock Preview - No live data";
    els.adminPacketsMockPanel.appendChild(mockBadge);

    const title = document.createElement("div");
    title.className = "note";
    title.textContent = "Ashley High School - Concert Band";
    els.adminPacketsMockPanel.appendChild(title);

    const header = document.createElement("div");
    header.className = "packet-header";
    header.textContent = `Director: Robert Parker - Grade: IV - Overall: ${overallLabel}`;
    els.adminPacketsMockPanel.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "packet-grid";
    Object.values(JUDGE_POSITIONS).forEach((position) => {
      const wrapper = document.createElement("div");
      wrapper.className = "packet-slot";
      wrapper.appendChild(renderSubmissionCard(submissions[position], position));
      grid.appendChild(wrapper);
    });
    els.adminPacketsMockPanel.appendChild(grid);
  }

  return { renderMockAdminPacketPreview };
}
