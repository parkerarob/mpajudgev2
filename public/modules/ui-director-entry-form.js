export function createDirectorEntryFormRenderers({
  els,
  state,
  REPERTOIRE_FIELDS,
  STANDARD_INSTRUMENTS,
  PERCUSSION_OPTIONS,
  romanToLevel,
  derivePerformanceGrade,
  normalizeGrade,
  getMpaRepertoireForGrade,
  applyDirectorDirty,
  setDirectorPerformanceGradeValue,
  setPerformanceGradeError,
  updateLunchTotalCost,
} = {}) {
  function updateRepertoirePreview(wrapper, key) {
    if (!wrapper || !state.director.entryDraft) return;
    const preview = wrapper.querySelector(`[data-preview-key="${key}"]`);
    if (!preview) return;
    const grade = state.director.entryDraft.repertoire?.[key]?.grade || "";
    const title = state.director.entryDraft.repertoire?.[key]?.title || "";
    const composer = state.director.entryDraft.repertoire?.[key]?.composer || "";
    const parts = [];
    if (grade) parts.push(grade);
    if (title) parts.push(title);
    if (composer) parts.push(`- ${composer}`);
    preview.textContent = parts.length ? `Selected: ${parts.join(" ")}` : "";
  }

  function renderRepertoireFields() {
    if (!els.repertoireFields || !state.director.entryDraft) return;
    els.repertoireFields.innerHTML = "";
    if (!state.director.entryDraft.repertoire) {
      state.director.entryDraft.repertoire = {};
    }
    const repertoire = state.director.entryDraft.repertoire;
    if (!repertoire.repertoireRuleMode) {
      repertoire.repertoireRuleMode = "standard";
    }
    const flexCheckboxes = [];
    const syncRepertoireFlexCheckboxes = () => {
      const checked = Boolean(state.director.entryDraft?.performanceGradeFlex);
      flexCheckboxes.forEach((cb) => {
        cb.checked = checked;
      });
    };

    REPERTOIRE_FIELDS.forEach((piece) => {
      const wrapper = document.createElement("div");
      wrapper.className = "stack";
      if (!repertoire[piece.key]) {
        repertoire[piece.key] = {
          pieceId: null,
          grade: "",
          title: "",
          composer: "",
        };
      }
      const pieceData = repertoire[piece.key];
      if (piece.key === "march") {
        const titleLabel = document.createElement("label");
        titleLabel.textContent = `${piece.label} Title`;
        const titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.placeholder = "Enter march title...";
        titleInput.value = pieceData?.title || "";
        titleLabel.appendChild(titleInput);
        wrapper.appendChild(titleLabel);

        const composerLabel = document.createElement("label");
        composerLabel.textContent = `${piece.label} Composer/Arranger`;
        const composerInput = document.createElement("input");
        composerInput.type = "text";
        composerInput.value = pieceData?.composer || "";
        composerLabel.appendChild(composerInput);
        wrapper.appendChild(composerLabel);

        titleInput.addEventListener("input", () => {
          pieceData.title = titleInput.value.trim();
          applyDirectorDirty("repertoire");
          updateRepertoirePreview(wrapper, piece.key);
        });
        composerInput.addEventListener("input", () => {
          pieceData.composer = composerInput.value.trim();
          applyDirectorDirty("repertoire");
          updateRepertoirePreview(wrapper, piece.key);
        });

        const preview = document.createElement("div");
        preview.className = "hint";
        preview.dataset.previewKey = piece.key;
        wrapper.appendChild(preview);
        updateRepertoirePreview(wrapper, piece.key);

        els.repertoireFields.appendChild(wrapper);
        return;
      }

      const row = document.createElement("div");
      row.className = "repertoire-row";

      const gradeLabel = document.createElement("label");
      gradeLabel.textContent = "Grade";
      const gradeSelect = document.createElement("select");
      gradeLabel.appendChild(gradeSelect);
      const baseOption = document.createElement("option");
      baseOption.value = "";
      baseOption.textContent = "Grade";
      gradeSelect.appendChild(baseOption);
      ["I", "II", "III", "IV", "V", "VI"].forEach((roman) => {
        const option = document.createElement("option");
        option.value = roman;
        option.textContent = roman;
        gradeSelect.appendChild(option);
      });
      gradeSelect.value = pieceData?.grade || "";

      const titleLabel = document.createElement("label");
      titleLabel.textContent = `${piece.label} Title`;
      const combo = document.createElement("div");
      combo.className = "mpa-combobox";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.placeholder = "Start typing a title...";
      titleInput.value = pieceData?.title || "";
      const list = document.createElement("div");
      list.className = "mpa-combobox-list";
      list.hidden = true;
      let suggestionRenderVersion = 0;
      const closeSuggestions = () => {
        suggestionRenderVersion += 1;
        list.hidden = true;
      };
      combo.appendChild(titleInput);
      combo.appendChild(list);
      titleLabel.appendChild(combo);

      row.appendChild(gradeLabel);
      row.appendChild(titleLabel);
      wrapper.appendChild(row);

      const composerRow = document.createElement("div");
      composerRow.className = "row repertoire-composer-row";
      const composerLabel = document.createElement("label");
      composerLabel.textContent = `${piece.label} Composer/Arranger`;
      const composerInput = document.createElement("input");
      composerInput.type = "text";
      composerInput.value = pieceData?.composer || "";
      composerInput.readOnly = Boolean(pieceData?.pieceId);
      composerLabel.appendChild(composerInput);
      const composerEditBtn = document.createElement("button");
      composerEditBtn.type = "button";
      composerEditBtn.className = "ghost btn--sm";
      composerEditBtn.textContent = "Edit";
      composerEditBtn.addEventListener("click", () => {
        composerInput.readOnly = !composerInput.readOnly;
        composerEditBtn.textContent = composerInput.readOnly ? "Edit" : "Lock";
        if (!composerInput.readOnly) {
          composerInput.focus();
        }
      });
      composerRow.appendChild(composerLabel);
      composerRow.appendChild(composerEditBtn);
      wrapper.appendChild(composerRow);

      if (piece.key === "selection1" || piece.key === "selection2") {
        const flexRow = document.createElement("label");
        flexRow.className = "director-flex-row";
        const flexCheckbox = document.createElement("input");
        flexCheckbox.type = "checkbox";
        flexCheckbox.checked = Boolean(state.director.entryDraft.performanceGradeFlex);
        flexCheckbox.addEventListener("change", () => {
          state.director.entryDraft.performanceGradeFlex = Boolean(flexCheckbox.checked);
          syncRepertoireFlexCheckboxes();
          setDirectorPerformanceGradeValue(state.director.entryDraft.performanceGrade || "");
          applyDirectorDirty("repertoire");
        });
        flexCheckboxes.push(flexCheckbox);
        const flexText = document.createElement("span");
        flexText.textContent = "Flex";
        flexRow.appendChild(flexCheckbox);
        flexRow.appendChild(flexText);
        wrapper.appendChild(flexRow);
      }

      if (piece.key === "selection2") {
        const masterworkWrap = document.createElement("label");
        masterworkWrap.className = "row";
        masterworkWrap.style.alignItems = "center";
        const masterworkCheckbox = document.createElement("input");
        masterworkCheckbox.type = "checkbox";
        masterworkCheckbox.checked = repertoire.repertoireRuleMode === "masterwork";
        masterworkCheckbox.addEventListener("change", () => {
          repertoire.repertoireRuleMode = masterworkCheckbox.checked ? "masterwork" : "standard";
          applyDirectorDirty("repertoire");
        });
        const masterworkText = document.createElement("span");
        masterworkText.textContent =
          "Masterwork Exception (Selection #2 optional if Selection #1 is a Masterwork)";
        masterworkWrap.appendChild(masterworkCheckbox);
        masterworkWrap.appendChild(masterworkText);
        wrapper.appendChild(masterworkWrap);
      }

      const preview = document.createElement("div");
      preview.className = "hint";
      preview.dataset.previewKey = piece.key;
      wrapper.appendChild(preview);
      updateRepertoirePreview(wrapper, piece.key);

      const updatePerformanceGrade = () => {
        const selection1Level = romanToLevel(
          state.director.entryDraft.repertoire?.selection1?.grade
        );
        const selection2Level = romanToLevel(
          state.director.entryDraft.repertoire?.selection2?.grade
        );
        const derived = derivePerformanceGrade(selection1Level, selection2Level);
        if (derived.ok) {
          state.director.entryDraft.performanceGrade = derived.value;
          if (els.directorPerformanceGradeInput) {
            els.directorPerformanceGradeInput.value = derived.value;
          }
          setPerformanceGradeError("");
        }
      };

      const renderSuggestions = async () => {
        const renderVersion = ++suggestionRenderVersion;
        list.innerHTML = "";
        const grade = pieceData.grade;
        if (!grade) {
          const empty = document.createElement("div");
          empty.className = "mpa-combobox-empty";
          empty.textContent = "Select a grade to browse titles.";
          list.appendChild(empty);
          list.hidden = false;
          return;
        }
        list.hidden = false;
        const loading = document.createElement("div");
        loading.className = "mpa-combobox-empty";
        loading.textContent = "Loading titles...";
        list.appendChild(loading);
        const options = await getMpaRepertoireForGrade(grade);
        if (renderVersion !== suggestionRenderVersion) return;
        const queryText = titleInput.value.trim().toLowerCase();
        const filtered = options.filter((item) => {
          const hay = item.titleLower || item.title.toLowerCase();
          return !queryText || hay.includes(queryText);
        });
        const top = filtered.slice(0, 20);
        list.innerHTML = "";
        if (!top.length) {
          const empty = document.createElement("div");
          empty.className = "mpa-combobox-empty";
          empty.textContent = "No matches found.";
          list.appendChild(empty);
          return;
        }
        top.forEach((item) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "mpa-combobox-option";
          const masterworkBadge = item.isMasterwork ? " [Masterwork]" : "";
          option.textContent = `${item.title}${item.composer ? ` - ${item.composer}` : ""}${masterworkBadge}`;
          option.addEventListener("click", () => {
            pieceData.pieceId = item.id;
            pieceData.grade = grade;
            pieceData.title = item.title || "";
            pieceData.composer = item.composer || "";
            titleInput.value = pieceData.title;
            composerInput.value = pieceData.composer;
            composerInput.readOnly = true;
            composerEditBtn.textContent = "Edit";
            closeSuggestions();
            applyDirectorDirty("repertoire");
            updatePerformanceGrade();
            updateRepertoirePreview(wrapper, piece.key);
          });
          list.appendChild(option);
        });
      };

      gradeSelect.addEventListener("change", async () => {
        const nextGrade = gradeSelect.value || "";
        if (pieceData.grade !== nextGrade) {
          pieceData.grade = nextGrade;
          pieceData.pieceId = null;
          pieceData.title = "";
          pieceData.composer = "";
          titleInput.value = "";
          composerInput.value = "";
          composerInput.readOnly = false;
          composerEditBtn.textContent = "Edit";
          closeSuggestions();
          list.innerHTML = "";
        }
        applyDirectorDirty("repertoire");
        updatePerformanceGrade();
        updateRepertoirePreview(wrapper, piece.key);
        if (nextGrade) {
          await getMpaRepertoireForGrade(nextGrade);
        }
      });

      titleInput.addEventListener("input", () => {
        pieceData.title = titleInput.value.trim();
        pieceData.pieceId = null;
        composerInput.readOnly = false;
        composerEditBtn.textContent = "Edit";
        applyDirectorDirty("repertoire");
        updateRepertoirePreview(wrapper, piece.key);
        renderSuggestions();
      });

      titleInput.addEventListener("focus", () => {
        renderSuggestions();
      });

      titleInput.addEventListener("blur", () => {
        window.setTimeout(() => {
          closeSuggestions();
        }, 120);
      });

      composerInput.addEventListener("input", () => {
        pieceData.composer = composerInput.value.trim();
        applyDirectorDirty("repertoire");
        updateRepertoirePreview(wrapper, piece.key);
      });

      const selectedMeta = document.createElement("div");
      selectedMeta.className = "hint";
      const updateSelectedMeta = async () => {
        const selection = state.director.entryDraft.repertoire?.[piece.key] || {};
        const grade = normalizeGrade(selection.grade);
        if (!selection.pieceId || !grade) {
          selectedMeta.textContent = "";
          return;
        }
        const options = await getMpaRepertoireForGrade(grade);
        const match = options.find((item) => item.id === selection.pieceId);
        if (!match) {
          selectedMeta.textContent = "";
          return;
        }
        const tags = [];
        if (match.isMasterwork || `${match.specialInstructions || ""} ${match.status || ""} ${(match.tags || []).join(" ")}`.toLowerCase().includes("masterwork")) {
          tags.push("Masterwork");
        }
        if (match.grade === "VI") {
          tags.push("Grade VI");
        }
        selectedMeta.textContent = tags.length ? `Tags: ${tags.join(" - ")}` : "";
      };
      wrapper.appendChild(selectedMeta);
      updateSelectedMeta();

      els.repertoireFields.appendChild(wrapper);
    });
    syncRepertoireFlexCheckboxes();
  }

  function renderInstrumentationStandard() {
    if (!els.instrumentationStandard || !state.director.entryDraft) return;
    els.instrumentationStandard.innerHTML = "";
    STANDARD_INSTRUMENTS.forEach((instrument) => {
      const label = document.createElement("label");
      label.textContent = instrument.label;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.value = "0";
      label.appendChild(input);
      const current =
        state.director.entryDraft.instrumentation?.standardCounts?.[instrument.key] ?? 0;
      input.value = Number(current || 0);
      input.dataset.instrumentKey = instrument.key;
      input.addEventListener("change", () => {
        state.director.entryDraft.instrumentation.standardCounts[instrument.key] = Number(
          input.value || 0
        );
        applyDirectorDirty("instrumentation");
      });
      els.instrumentationStandard.appendChild(label);
    });
  }

  function renderInstrumentationNonStandard() {
    if (!els.instrumentationNonStandard || !state.director.entryDraft) return;
    els.instrumentationNonStandard.innerHTML = "";
    state.director.entryDraft.instrumentation.nonStandard.forEach((row, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry-row";
      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Instrument";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameLabel.appendChild(nameInput);
      nameInput.value = row.instrumentName || "";
      nameInput.addEventListener("blur", () => {
        if (!state.director.entryDraft) return;
        state.director.entryDraft.instrumentation.nonStandard[index].instrumentName =
          nameInput.value.trim();
        applyDirectorDirty("instrumentation");
      });

      const countLabel = document.createElement("label");
      countLabel.textContent = "Count";
      const countInput = document.createElement("input");
      countInput.type = "number";
      countInput.min = "0";
      countInput.value = "0";
      countLabel.appendChild(countInput);
      countInput.value = Number(row.count || 0);
      countInput.addEventListener("change", () => {
        if (!state.director.entryDraft) return;
        state.director.entryDraft.instrumentation.nonStandard[index].count = Number(
          countInput.value || 0
        );
        applyDirectorDirty("instrumentation");
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        state.director.entryDraft.instrumentation.nonStandard.splice(index, 1);
        renderInstrumentationNonStandard();
        applyDirectorDirty("instrumentation");
      });

      wrapper.appendChild(nameLabel);
      wrapper.appendChild(countLabel);
      wrapper.appendChild(removeBtn);
      els.instrumentationNonStandard.appendChild(wrapper);
    });
  }

  function renderRule3cRows() {
    if (!els.rule3cRows || !state.director.entryDraft) return;
    els.rule3cRows.innerHTML = "";
    const otherEnsembles = state.director.ensemblesCache.filter(
      (ensemble) => ensemble.id !== state.director.selectedEnsembleId
    );
    state.director.entryDraft.rule3c.entries.forEach((row, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry-row";
      const studentLabel = document.createElement("label");
      studentLabel.textContent = "Student Name/Identifier";
      const studentInput = document.createElement("input");
      studentInput.type = "text";
      studentLabel.appendChild(studentInput);
      studentInput.value = row.studentNameOrIdentifier || "";
      studentInput.addEventListener("blur", () => {
        state.director.entryDraft.rule3c.entries[index].studentNameOrIdentifier =
          studentInput.value.trim();
        applyDirectorDirty("rule3c");
      });

      const instrumentLabel = document.createElement("label");
      instrumentLabel.textContent = "Instrument";
      const instrumentInput = document.createElement("input");
      instrumentInput.type = "text";
      instrumentLabel.appendChild(instrumentInput);
      instrumentInput.value = row.instrument || "";
      instrumentInput.addEventListener("blur", () => {
        state.director.entryDraft.rule3c.entries[index].instrument =
          instrumentInput.value.trim();
        applyDirectorDirty("rule3c");
      });

      const ensembleLabel = document.createElement("label");
      ensembleLabel.textContent = "Also doubles in ensemble";
      const ensembleSelect = document.createElement("select");
      ensembleLabel.appendChild(ensembleSelect);
      const baseOption = document.createElement("option");
      baseOption.value = "";
      baseOption.textContent = "Select ensemble";
      ensembleSelect.appendChild(baseOption);
      otherEnsembles.forEach((ensemble) => {
        const option = document.createElement("option");
        option.value = ensemble.id;
        option.textContent = ensemble.name || ensemble.id;
        ensembleSelect.appendChild(option);
      });
      ensembleSelect.value = row.alsoDoublesInEnsembleId || "";
      ensembleSelect.addEventListener("change", () => {
        state.director.entryDraft.rule3c.entries[index].alsoDoublesInEnsembleId =
          ensembleSelect.value;
        applyDirectorDirty("rule3c");
      });

      wrapper.appendChild(studentLabel);
      wrapper.appendChild(instrumentLabel);
      wrapper.appendChild(ensembleLabel);
      els.rule3cRows.appendChild(wrapper);
    });
  }

  function renderSeatingRows() {
    if (!els.seatingRows || !state.director.entryDraft) return;
    els.seatingRows.innerHTML = "";
    state.director.entryDraft.seating.rows.forEach((row, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry-row";
      const chairsLabel = document.createElement("label");
      chairsLabel.textContent = `Chairs (Row ${index + 1})`;
      const chairsInput = document.createElement("input");
      chairsInput.type = "number";
      chairsInput.min = "0";
      chairsInput.value = "0";
      chairsLabel.appendChild(chairsInput);
      chairsInput.value = Number(row.chairs || 0);
      chairsInput.addEventListener("change", () => {
        state.director.entryDraft.seating.rows[index].chairs = Number(
          chairsInput.value || 0
        );
        applyDirectorDirty("seating");
      });

      const standsLabel = document.createElement("label");
      standsLabel.textContent = `Stands (Row ${index + 1})`;
      const standsInput = document.createElement("input");
      standsInput.type = "number";
      standsInput.min = "0";
      standsInput.value = "0";
      standsLabel.appendChild(standsInput);
      standsInput.value = Number(row.stands || 0);
      standsInput.addEventListener("change", () => {
        state.director.entryDraft.seating.rows[index].stands = Number(
          standsInput.value || 0
        );
        applyDirectorDirty("seating");
      });

      wrapper.appendChild(chairsLabel);
      wrapper.appendChild(standsLabel);
      els.seatingRows.appendChild(wrapper);
    });
  }

  function renderPercussionOptions() {
    if (!els.percussionOptions || !state.director.entryDraft) return;
    els.percussionOptions.innerHTML = "";
    const selected = new Set(state.director.entryDraft.percussionNeeds.selected || []);
    PERCUSSION_OPTIONS.forEach((item) => {
      const label = document.createElement("label");
      label.className = "row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(item);
      checkbox.addEventListener("change", () => {
        if (!state.director.entryDraft) return;
        const current = new Set(state.director.entryDraft.percussionNeeds.selected || []);
        if (checkbox.checked) {
          current.add(item);
        } else {
          current.delete(item);
        }
        state.director.entryDraft.percussionNeeds.selected = Array.from(current);
        applyDirectorDirty("percussion");
      });
      const text = document.createElement("span");
      text.textContent = item;
      label.appendChild(checkbox);
      label.appendChild(text);
      els.percussionOptions.appendChild(label);
    });
  }

  function renderDirectorEntryForm() {
    if (!state.director.entryDraft) {
      if (els.directorEntryForm) els.directorEntryForm.reset?.();
      return;
    }
    if (els.directorPerformanceGradeInput) {
      setDirectorPerformanceGradeValue(state.director.entryDraft.performanceGrade || "");
      els.directorPerformanceGradeInput.oninput = null;
    }
    if (els.directorPerformanceGradeFlex) {
      els.directorPerformanceGradeFlex.checked = Boolean(
        state.director.entryDraft.performanceGradeFlex
      );
      els.directorPerformanceGradeFlex.onchange = () => {
        state.director.entryDraft.performanceGradeFlex =
          els.directorPerformanceGradeFlex.checked;
        setDirectorPerformanceGradeValue(state.director.entryDraft.performanceGrade || "");
        applyDirectorDirty("repertoire");
      };
    }
    if (els.directorCommentsOnlyInput) {
      els.directorCommentsOnlyInput.checked = Boolean(state.director.entryDraft.commentsOnly);
      els.directorCommentsOnlyInput.onchange = () => {
        if (els.directorFeeWaiverInput?.checked) {
          els.directorCommentsOnlyInput.checked = true;
          state.director.entryDraft.commentsOnly = true;
        } else {
          state.director.entryDraft.commentsOnly = els.directorCommentsOnlyInput.checked;
        }
        applyDirectorDirty("registration");
      };
    }
    if (els.directorFeeWaiverInput) {
      els.directorFeeWaiverInput.checked = Boolean(state.director.entryDraft.feeWaiverRequested);
      els.directorFeeWaiverInput.onchange = () => {
        state.director.entryDraft.feeWaiverRequested = els.directorFeeWaiverInput.checked;
        if (els.directorFeeWaiverInput.checked) {
          state.director.entryDraft.commentsOnly = true;
          if (els.directorCommentsOnlyInput) els.directorCommentsOnlyInput.checked = true;
        }
        applyDirectorDirty("registration");
      };
    }
    if (els.directorDatePreferenceInput) {
      els.directorDatePreferenceInput.value = state.director.entryDraft.datePreference || "";
      els.directorDatePreferenceInput.oninput = () => {
        state.director.entryDraft.datePreference = els.directorDatePreferenceInput.value.trim();
        applyDirectorDirty("registration");
      };
    }
    if (els.directorRegistrationNoteInput) {
      els.directorRegistrationNoteInput.value = state.director.entryDraft.registrationNote || "";
      els.directorRegistrationNoteInput.oninput = () => {
        state.director.entryDraft.registrationNote = els.directorRegistrationNoteInput.value;
        applyDirectorDirty("registration");
      };
    }
    if (els.instrumentationTotalPercussion) {
      els.instrumentationTotalPercussion.value = Number(
        state.director.entryDraft.instrumentation?.totalPercussion || 0
      );
      els.instrumentationTotalPercussion.onchange = () => {
        state.director.entryDraft.instrumentation.totalPercussion = Number(
          els.instrumentationTotalPercussion.value || 0
        );
        applyDirectorDirty("instrumentation");
      };
    }
    if (els.otherInstrumentationNotesInput) {
      els.otherInstrumentationNotesInput.value =
        state.director.entryDraft.instrumentation?.otherInstrumentationNotes || "";
      els.otherInstrumentationNotesInput.oninput = () => {
        state.director.entryDraft.instrumentation.otherInstrumentationNotes =
          els.otherInstrumentationNotesInput.value || "";
        applyDirectorDirty("instrumentation");
      };
    }
    if (els.rule3cNotesInput) {
      els.rule3cNotesInput.value = state.director.entryDraft.rule3c?.notes || "";
      els.rule3cNotesInput.oninput = () => {
        state.director.entryDraft.rule3c.notes = els.rule3cNotesInput.value || "";
        applyDirectorDirty("rule3c");
      };
    }
    if (els.seatingNotesInput) {
      els.seatingNotesInput.value = state.director.entryDraft.seating?.notes || "";
      els.seatingNotesInput.oninput = () => {
        state.director.entryDraft.seating.notes = els.seatingNotesInput.value || "";
        applyDirectorDirty("seating");
      };
    }
    if (els.percussionNotesInput) {
      els.percussionNotesInput.value =
        state.director.entryDraft.percussionNeeds?.notes || "";
      els.percussionNotesInput.oninput = () => {
        state.director.entryDraft.percussionNeeds.notes =
          els.percussionNotesInput.value || "";
        applyDirectorDirty("percussion");
      };
    }
    if (els.lunchPepperoniInput) {
      els.lunchPepperoniInput.value = Number(
        state.director.entryDraft.lunchOrder?.pepperoniQty || 0
      );
      els.lunchPepperoniInput.onchange = () => {
        state.director.entryDraft.lunchOrder.pepperoniQty = Number(
          els.lunchPepperoniInput.value || 0
        );
        applyDirectorDirty("lunch");
        updateLunchTotalCost();
      };
    }
    if (els.lunchCheeseInput) {
      els.lunchCheeseInput.value = Number(
        state.director.entryDraft.lunchOrder?.cheeseQty || 0
      );
      els.lunchCheeseInput.onchange = () => {
        state.director.entryDraft.lunchOrder.cheeseQty = Number(
          els.lunchCheeseInput.value || 0
        );
        applyDirectorDirty("lunch");
        updateLunchTotalCost();
      };
    }

    updateLunchTotalCost();

    renderRepertoireFields();
    renderInstrumentationStandard();
    renderInstrumentationNonStandard();
    renderRule3cRows();
    renderSeatingRows();
    renderPercussionOptions();
  }

  function setDirectorEntryHint(message) {
    if (!els.directorEntryHint) return;
    els.directorEntryHint.textContent = message || "";
  }

  function renderStatusSummary({
    rootId,
    root,
    title,
    done,
    total,
    pillText,
    hintText,
    openWhenIncomplete = true,
  }) {
    const resolvedRoot = root || (rootId ? document.getElementById(rootId) : null);
    if (!resolvedRoot) return;
    const titleEl = resolvedRoot.querySelector(".readiness-title");
    const metaEl = resolvedRoot.querySelector(".readiness-meta");
    const barEl = resolvedRoot.querySelector(".progress-bar");
    const pillEl = resolvedRoot.querySelector(".pill");
    const detailsEl = resolvedRoot.querySelector("details");
    const hintEl = resolvedRoot.querySelector(".readiness-hint");
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    if (titleEl) titleEl.textContent = title;
    if (metaEl) metaEl.textContent = `${done}/${total} complete`;
    if (barEl) barEl.style.width = `${pct}%`;
    if (pillEl) pillEl.textContent = pillText;
    if (hintEl) hintEl.textContent = hintText;
    if (detailsEl && openWhenIncomplete) detailsEl.open = done !== total;
  }

  function renderChecklist(listEl, items, status) {
    if (!listEl) return;
    listEl.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "checklist-item";

      const label = document.createElement("span");
      label.textContent = item.label;

      const check = document.createElement("span");
      const ok = Boolean(status[item.key]);
      check.textContent = ok ? "" : "Missing";
      check.className = ok ? "check" : "check is-missing";

      li.appendChild(label);
      li.appendChild(check);
      listEl.appendChild(li);
    });
  }

  function renderDirectorChecklist(_entry, completionState) {
    if (!els.directorChecklist) return;
    const s = completionState || {};
    const items = [
      { key: "ensemble", label: "Ensemble" },
      { key: "repertoire", label: "Repertoire" },
      { key: "instrumentation", label: "Instrumentation" },
      { key: "seating", label: "Seating" },
      { key: "percussion", label: "Percussion" },
      { key: "lunch", label: "Lunch" },
      { key: "grade", label: "Grade" },
    ];

    const total = items.length;
    const done = items.filter((item) => Boolean(s[item.key])).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    renderStatusSummary({
      rootId: "directorChecklistPanel",
      title: done === total ? "Ready to submit" : "Not ready yet",
      done,
      total,
      pillText: done === total ? "Complete" : "Incomplete",
      hintText: done === total ? "" : `${total - done} missing`,
    });

    if (els.directorSummaryStatus) {
      els.directorSummaryStatus.textContent = done === total ? "Ready" : "Incomplete";
    }
    if (els.directorSummaryCompletion) {
      els.directorSummaryCompletion.textContent = `${pct}%`;
    }
    if (els.directorSummaryProgressBar) {
      els.directorSummaryProgressBar.style.width = `${pct}%`;
    }

    renderChecklist(els.directorChecklist, items, s);

    const parent = els.directorChecklist?.parentElement;
    if (parent) {
      let reminder = parent.querySelector(".registration-paper-reminder");
      if (!reminder) {
        reminder = document.createElement("div");
        reminder.className = "registration-paper-reminder hint";
        parent.appendChild(reminder);
      }
      reminder.textContent = "Paper scores (3 per piece) - bring to Registration.";
    }
  }

  function renderAdminReadiness() {
    if (!els.adminReadinessChecklist) return;
    const hasEvent = Boolean(state.event.active);
    const assignments = state.event.assignments || {};
    const hasAssignments =
      hasEvent &&
      Boolean(assignments.stage1Uid) &&
      Boolean(assignments.stage2Uid) &&
      Boolean(assignments.stage3Uid) &&
      Boolean(assignments.sightUid);
    const items = [
      { key: "event", label: "Active event" },
      { key: "assignments", label: "Judge assignments" },
    ];
    const status = {
      event: hasEvent,
      assignments: hasAssignments,
    };
    const total = items.length;
    const done = items.filter((item) => Boolean(status[item.key])).length;

    renderStatusSummary({
      rootId: "adminReadinessPanel",
      title: done === total ? "Ready to run event" : "Setup in progress",
      done,
      total,
      pillText: done === total ? "Complete" : "Draft",
      hintText: done === total ? "" : `${total - done} missing`,
    });

    renderChecklist(els.adminReadinessChecklist, items, status);
  }

  return {
    updateRepertoirePreview,
    renderRepertoireFields,
    renderInstrumentationStandard,
    renderInstrumentationNonStandard,
    renderRule3cRows,
    renderSeatingRows,
    renderPercussionOptions,
    renderDirectorEntryForm,
    setDirectorEntryHint,
    renderStatusSummary,
    renderChecklist,
    renderDirectorChecklist,
    renderAdminReadiness,
  };
}
