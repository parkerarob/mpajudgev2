export function createDirectorRegistrationRenderers({
  els,
  state,
  db,
  COLLECTIONS,
  doc,
  getDoc,
  getDirectorSchoolId,
  getEventCardLabel,
  alertUser,
  createDirectorEnsemble,
  refreshDirectorWatchers,
  upsertRegistrationForEnsemble,
} = {}) {
  const REGISTRATION_GRADES = ["I", "II", "III", "IV", "V", "VI"];

  function getEventDaysForRegistration(activeEvent) {
    if (!activeEvent) return [];
    const start = activeEvent.startAt?.toDate ? activeEvent.startAt.toDate() : null;
    const end = activeEvent.endAt?.toDate ? activeEvent.endAt.toDate() : null;
    if (!start) return [];
    const endDate = end && end.getTime() >= start.getTime() ? end : start;
    const days = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    let dayNum = 1;
    while (cursor.getTime() <= endDay.getTime()) {
      const label = `Day ${dayNum} – ${cursor.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`;
      days.push({ value: label, label });
      cursor.setDate(cursor.getDate() + 1);
      dayNum += 1;
    }
    return days;
  }

  async function checkDirectorHasRegistrationForEvent(eventId) {
    const schoolId = getDirectorSchoolId();
    const ensembles = state.director.ensemblesCache || [];
    if (!schoolId || !eventId || !ensembles.length) return false;
    for (const ensemble of ensembles) {
      const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensemble.id);
      const snap = await getDoc(entryRef);
      if (snap.exists()) return true;
    }
    return false;
  }

  async function renderDirectorRegistrationPanel() {
    if (!els.directorRegistrationPanel) return;
    const schoolId = getDirectorSchoolId();
    const eventId = state.director.selectedEventId || null;
    const event = eventId ? (state.event.list || []).find((e) => e.id === eventId) : null;
    const ensembles = state.director.ensemblesCache || [];
    const activeEvent = event;

    if (!schoolId || !event) return;

    if (els.directorRegistrationEventName) {
      els.directorRegistrationEventName.textContent = getEventCardLabel(event);
    }
    if (els.directorRegistrationEventDates) {
      const startDate = event.startAt?.toDate ? event.startAt.toDate().toLocaleDateString() : "";
      const endDate = event.endAt?.toDate ? event.endAt.toDate().toLocaleDateString() : "";
      els.directorRegistrationEventDates.textContent =
        startDate && endDate && startDate !== endDate
          ? `${startDate} – ${endDate}`
          : startDate || endDate || "—";
    }
    if (els.directorRegistrationDeadline) {
      const deadline = event.registrationDeadline?.toDate
        ? event.registrationDeadline.toDate().toLocaleDateString()
        : null;
      els.directorRegistrationDeadline.textContent = deadline
        ? `Registration deadline: ${deadline}`
        : "";
    }

    const entryDataByEnsemble = new Map();
    if (eventId && ensembles.length) {
      await Promise.all(
        ensembles.map(async (ensemble) => {
          const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensemble.id);
          const snap = await getDoc(entryRef);
          if (snap.exists()) {
            entryDataByEnsemble.set(ensemble.id, snap.data());
          }
        })
      );
    }

    state.director.selectedEnsemblesForRegistration = state.director.selectedEnsemblesForRegistration || [];
    if (state.director.selectedEnsemblesForRegistration.length === 0 && entryDataByEnsemble.size > 0) {
      state.director.selectedEnsemblesForRegistration = Array.from(entryDataByEnsemble.keys());
    }
    const selectedIds = state.director.selectedEnsemblesForRegistration;
    const selectedEnsembles = ensembles.filter((e) => selectedIds.includes(e.id));

    if (els.directorRegistrationEnsembleList) {
      els.directorRegistrationEnsembleList.innerHTML = "";
      ensembles.forEach((ensemble) => {
        const row = document.createElement("label");
        row.className = "row";
        row.style.alignItems = "center";
        row.style.gap = "0.5rem";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = selectedIds.includes(ensemble.id);
        check.addEventListener("change", () => {
          if (check.checked) {
            if (!state.director.selectedEnsemblesForRegistration.includes(ensemble.id)) {
              state.director.selectedEnsemblesForRegistration.push(ensemble.id);
            }
          } else {
            state.director.selectedEnsemblesForRegistration = state.director.selectedEnsemblesForRegistration.filter((x) => x !== ensemble.id);
          }
          renderDirectorRegistrationPanel();
        });
        const nameSpan = document.createElement("span");
        nameSpan.textContent = ensemble.name || "Untitled";
        row.appendChild(check);
        row.appendChild(nameSpan);
        els.directorRegistrationEnsembleList.appendChild(row);
      });
      const createRow = document.createElement("div");
      createRow.className = "stack registration-add-ensemble";
      createRow.style.marginTop = "1rem";
      const createHint = document.createElement("p");
      createHint.className = "hint";
      createHint.textContent = "Don't see your ensemble? Create one:";
      createRow.appendChild(createHint);
      const createLabel = document.createElement("label");
      createLabel.className = "row";
      createLabel.style.alignItems = "center";
      createLabel.style.gap = "0.5rem";
      const createInput = document.createElement("input");
      createInput.type = "text";
      createInput.placeholder = "Ensemble name";
      createInput.id = "directorRegistrationNewEnsembleInput";
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "btn--secondary";
      createBtn.textContent = "Create ensemble";
      createBtn.addEventListener("click", async () => {
        const name = (createInput.value || "").trim();
        if (!name) {
          alertUser("Enter an ensemble name.");
          return;
        }
        const result = await createDirectorEnsemble(name);
        if (result?.ok) {
          createInput.value = "";
          if (result.id && !state.director.selectedEnsemblesForRegistration.includes(result.id)) {
            state.director.selectedEnsemblesForRegistration.push(result.id);
          }
          refreshDirectorWatchers();
          await renderDirectorRegistrationPanel();
        } else {
          alertUser(result?.message || "Could not create ensemble.");
        }
      });
      createLabel.appendChild(createInput);
      createLabel.appendChild(createBtn);
      createRow.appendChild(createLabel);
      els.directorRegistrationEnsembleList.appendChild(createRow);
    }

    state.director._registrationGradeFlexMap = new Map();
    const eventDays = getEventDaysForRegistration(activeEvent);

    if (els.directorRegistrationGradeFlexList) {
      els.directorRegistrationGradeFlexList.innerHTML = "";
      selectedEnsembles.forEach((ensemble) => {
        const data = entryDataByEnsemble.get(ensemble.id) || {};
        const row = document.createElement("div");
        row.className = "stack registration-ensemble-row";
        row.dataset.registrationEnsembleId = ensemble.id;
        const nameEl = document.createElement("strong");
        nameEl.textContent = ensemble.name || "Untitled";
        row.appendChild(nameEl);

        const gradeLabel = document.createElement("label");
        gradeLabel.textContent = "Performance grade (declared for scheduling) ";
        const gradeSelect = document.createElement("select");
        gradeSelect.dataset.ensembleId = ensemble.id;
        REGISTRATION_GRADES.forEach((g) => {
          const opt = document.createElement("option");
          opt.value = g;
          opt.textContent = g;
          if ((data.declaredGradeLevel || "").trim() === g) opt.selected = true;
          gradeSelect.appendChild(opt);
        });
        gradeLabel.appendChild(gradeSelect);
        row.appendChild(gradeLabel);

        const flexLabel = document.createElement("label");
        flexLabel.className = "row";
        const flexCheck = document.createElement("input");
        flexCheck.type = "checkbox";
        flexCheck.dataset.ensembleId = ensemble.id;
        flexCheck.checked = Boolean(data.declaredGradeFlex);
        flexLabel.appendChild(flexCheck);
        flexLabel.appendChild(document.createTextNode(" Flex"));
        row.appendChild(flexLabel);

        const commentsLabel = document.createElement("label");
        commentsLabel.className = "row";
        const commentsCheck = document.createElement("input");
        commentsCheck.type = "checkbox";
        commentsCheck.dataset.ensembleId = ensemble.id;
        commentsCheck.checked = Boolean(data.commentsOnly);
        commentsLabel.appendChild(commentsCheck);
        commentsLabel.appendChild(document.createTextNode(" Comments only"));
        row.appendChild(commentsLabel);

        const waiverLabel = document.createElement("label");
        waiverLabel.className = "row";
        const waiverCheck = document.createElement("input");
        waiverCheck.type = "checkbox";
        waiverCheck.dataset.ensembleId = ensemble.id;
        waiverCheck.checked = Boolean(data.feeWaiverRequested);
        if (waiverCheck.checked) commentsCheck.checked = true;
        waiverLabel.appendChild(waiverCheck);
        waiverLabel.appendChild(document.createTextNode(" Apply for fee waiver"));
        row.appendChild(waiverLabel);

        const dateLabel = document.createElement("label");
        dateLabel.textContent = "Date preference ";
        const dateInput = document.createElement("select");
        dateInput.dataset.ensembleId = ensemble.id;
        const datePlaceholder = document.createElement("option");
        datePlaceholder.value = "";
        datePlaceholder.textContent = "Select day…";
        dateInput.appendChild(datePlaceholder);
        eventDays.forEach((d) => {
          const opt = document.createElement("option");
          opt.value = d.value;
          opt.textContent = d.label;
          if ((data.datePreference || "").trim() === d.value) opt.selected = true;
          dateInput.appendChild(opt);
        });
        if (!dateInput.value && (data.datePreference || "").trim()) {
          const existing = (data.datePreference || "").trim();
          const match = eventDays.find((d) => d.value === existing);
          if (!match) {
            const legacyOpt = document.createElement("option");
            legacyOpt.value = existing;
            legacyOpt.textContent = existing;
            legacyOpt.selected = true;
            dateInput.appendChild(legacyOpt);
          }
        }
        dateLabel.appendChild(dateInput);
        row.appendChild(dateLabel);

        const noteLabel = document.createElement("label");
        noteLabel.textContent = "Special requests / scheduling note";
        const noteInput = document.createElement("textarea");
        noteInput.rows = 2;
        noteInput.placeholder = "Time window or other requests";
        noteInput.value = data.registrationNote || "";
        noteInput.dataset.ensembleId = ensemble.id;
        noteLabel.appendChild(noteInput);
        row.appendChild(noteLabel);

        state.director._registrationGradeFlexMap.set(ensemble.id, {
          ensembleName: ensemble.name || "",
          gradeSelect,
          flexCheck,
          commentsCheck,
          waiverCheck,
          datePref: dateInput,
          note: noteInput,
        });

        const doUpsert = async () => {
          const commentsOnly = waiverCheck.checked || commentsCheck.checked;
          if (waiverCheck.checked) commentsCheck.checked = true;
          await upsertRegistrationForEnsemble({
            eventId,
            schoolId,
            ensembleId: ensemble.id,
            ensembleName: ensemble.name || "",
            declaredGradeLevel: gradeSelect.value,
            declaredGradeFlex: flexCheck.checked,
            commentsOnly,
            feeWaiverRequested: waiverCheck.checked,
            datePreference: dateInput.value.trim(),
            registrationNote: noteInput.value.trim(),
          });
          renderDirectorRegistrationPanel();
        };

        gradeSelect.addEventListener("change", doUpsert);
        flexCheck.addEventListener("change", doUpsert);
        commentsCheck.addEventListener("change", () => {
          if (waiverCheck.checked) {
            commentsCheck.checked = true;
            return;
          }
          doUpsert();
        });
        waiverCheck.addEventListener("change", () => {
          if (waiverCheck.checked) commentsCheck.checked = true;
          doUpsert();
        });
        dateInput.addEventListener("blur", doUpsert);
        noteInput.addEventListener("blur", doUpsert);

        els.directorRegistrationGradeFlexList.appendChild(row);
      });
    }

    if (els.directorRegistrationFeesHint) {
      const count = selectedIds.length;
      const total = count * 225;
      els.directorRegistrationFeesHint.textContent =
        count > 0
          ? `${count} ensemble(s) x $225 = $${total}. A Signature Form will be available after saving.`
          : "Each registered ensemble is $225.";
    }
  }

  async function renderDirectorPostRegistration() {
    const eventId = state.director.selectedEventId;
    const event = eventId ? (state.event.list || []).find((e) => e.id === eventId) : null;
    const schoolId = getDirectorSchoolId();
    const ensembles = state.director.ensemblesCache || [];
    if (!event || !schoolId) return;

    if (els.directorRegisteredEventName) {
      els.directorRegisteredEventName.textContent = getEventCardLabel(event);
    }
    if (els.directorRegisteredEventDates) {
      const startDate = event.startAt?.toDate ? event.startAt.toDate().toLocaleDateString() : "";
      const endDate = event.endAt?.toDate ? event.endAt.toDate().toLocaleDateString() : "";
      els.directorRegisteredEventDates.textContent =
        startDate && endDate && startDate !== endDate
          ? `${startDate} – ${endDate}`
          : startDate || endDate || "—";
    }
    if (els.directorRegisteredEnsemblesSummary) {
      els.directorRegisteredEnsemblesSummary.innerHTML = "";
      const heading = document.createElement("h4");
      heading.textContent = "Registered Ensembles";
      els.directorRegisteredEnsemblesSummary.appendChild(heading);
      for (const ensemble of ensembles) {
        const entryRef = doc(db, COLLECTIONS.events, eventId, COLLECTIONS.entries, ensemble.id);
        const snap = await getDoc(entryRef);
        if (!snap.exists()) continue;
        const data = snap.data();
        const row = document.createElement("div");
        row.className = "stack registration-ensemble-row";
        const name = document.createElement("strong");
        name.textContent = ensemble.name || "Untitled";
        row.appendChild(name);
        const meta = document.createElement("div");
        meta.className = "hint";
        const parts = [];
        if (data.declaredGradeLevel) parts.push(`Grade ${data.declaredGradeLevel}`);
        if (data.declaredGradeFlex) parts.push("Flex");
        if (data.commentsOnly) parts.push("Comments Only");
        if (data.feeWaiverRequested) parts.push("Fee Waiver");
        if (data.datePreference) parts.push(data.datePreference);
        meta.textContent = parts.join(" · ") || "No preferences set";
        row.appendChild(meta);
        if (data.registrationNote) {
          const note = document.createElement("div");
          note.className = "hint";
          note.textContent = `Note: ${data.registrationNote}`;
          row.appendChild(note);
        }
        els.directorRegisteredEnsemblesSummary.appendChild(row);
      }
    }
  }

  return {
    checkDirectorHasRegistrationForEvent,
    renderDirectorRegistrationPanel,
    renderDirectorPostRegistration,
  };
}
