import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  orderBy,
  addDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const COLLECTIONS = {
  users: "users",
  schools: "schools",
  events: "events",
  schedule: "schedule",
  assignments: "assignments",
  submissions: "submissions",
  ensembles: "ensembles",
};

const FIELDS = {
  users: {
    role: "role",
    schoolId: "schoolId",
  },
  schools: {
    directors: "directors",
  },
  events: {
    isActive: "isActive",
    name: "name",
  },
  schedule: {
    orderIndex: "orderIndex",
    stageTime: "stageTime",
    schoolId: "schoolId",
    ensembleId: "ensembleId",
  },
  submissions: {
    status: "status",
    locked: "locked",
    judgeUid: "judgeUid",
    schoolId: "schoolId",
    eventId: "eventId",
    ensembleId: "ensembleId",
    judgePosition: "judgePosition",
    formType: "formType",
    audioUrl: "audioUrl",
    audioDurationSec: "audioDurationSec",
    transcript: "transcript",
    captions: "captions",
    captionScoreTotal: "captionScoreTotal",
    computedFinalRatingJudge: "computedFinalRatingJudge",
    computedFinalRatingLabel: "computedFinalRatingLabel",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
};

const STATUSES = {
  submitted: "submitted",
  released: "released",
};

const JUDGE_POSITIONS = {
  stage1: "stage1",
  stage2: "stage2",
  stage3: "stage3",
  sight: "sight",
};

const FORM_TYPES = {
  stage: "stage",
  sight: "sight",
};

const CAPTION_TEMPLATES = {
  stage: [
    { key: "toneQuality", label: "Tone Quality" },
    { key: "intonation", label: "Intonation" },
    { key: "rhythm", label: "Rhythm & Precision" },
    { key: "balanceBlend", label: "Balance & Blend" },
    { key: "expression", label: "Expression" },
    { key: "technique", label: "Technique" },
    { key: "musicianship", label: "Musicianship" },
  ],
  sight: [
    { key: "accuracy", label: "Accuracy" },
    { key: "rhythm", label: "Rhythm & Pulse" },
    { key: "toneQuality", label: "Tone Quality" },
    { key: "balanceBlend", label: "Balance & Blend" },
    { key: "expression", label: "Expression" },
    { key: "musicianship", label: "Musicianship" },
    { key: "sightReading", label: "Sight Reading Fundamentals" },
  ],
};

const GRADE_VALUES = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  F: 5,
};

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

const useEmulators =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

const els = {
  authStatus: document.getElementById("authStatus"),
  roleHint: document.getElementById("roleHint"),
  emailForm: document.getElementById("emailForm"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  anonymousBtn: document.getElementById("anonymousBtn"),
  signOutBtn: document.getElementById("signOutBtn"),
  roleSelect: document.getElementById("roleSelect"),
  schoolIdInput: document.getElementById("schoolIdInput"),
  createUserBtn: document.getElementById("createUserBtn"),
  adminCard: document.getElementById("adminCard"),
  judgeCard: document.getElementById("judgeCard"),
  eventNameInput: document.getElementById("eventNameInput"),
  createEventBtn: document.getElementById("createEventBtn"),
  eventList: document.getElementById("eventList"),
  scheduleForm: document.getElementById("scheduleForm"),
  orderIndexInput: document.getElementById("orderIndexInput"),
  stageTimeInput: document.getElementById("stageTimeInput"),
  scheduleSchoolIdInput: document.getElementById("scheduleSchoolIdInput"),
  scheduleEnsembleIdInput: document.getElementById("scheduleEnsembleIdInput"),
  scheduleList: document.getElementById("scheduleList"),
  assignmentsForm: document.getElementById("assignmentsForm"),
  stage1UidInput: document.getElementById("stage1UidInput"),
  stage2UidInput: document.getElementById("stage2UidInput"),
  stage3UidInput: document.getElementById("stage3UidInput"),
  sightUidInput: document.getElementById("sightUidInput"),
  activeEventDisplay: document.getElementById("activeEventDisplay"),
  judgePositionDisplay: document.getElementById("judgePositionDisplay"),
  rosterSearch: document.getElementById("rosterSearch"),
  rosterList: document.getElementById("rosterList"),
  submissionHint: document.getElementById("submissionHint"),
  submissionForm: document.getElementById("submissionForm"),
  recordBtn: document.getElementById("recordBtn"),
  stopBtn: document.getElementById("stopBtn"),
  recordingStatus: document.getElementById("recordingStatus"),
  playback: document.getElementById("playback"),
  transcriptInput: document.getElementById("transcriptInput"),
  draftBtn: document.getElementById("draftBtn"),
  captionForm: document.getElementById("captionForm"),
  captionTotal: document.getElementById("captionTotal"),
  finalRating: document.getElementById("finalRating"),
  submitBtn: document.getElementById("submitBtn"),
};

let currentUser = null;
let userProfile = null;
let activeEvent = null;
let rosterEntries = [];
let assignments = null;
let judgePosition = null;
let formType = null;
let selectedRosterEntry = null;
let audioBlob = null;
let audioDurationSec = 0;
let captionsState = {};
let mediaRecorder = null;
let recordingChunks = [];

function setRoleHint(message) {
  els.roleHint.textContent = message;
}

function updateAuthUI() {
  if (currentUser) {
    els.authStatus.textContent = `Signed in: ${currentUser.uid}`;
    els.signOutBtn.disabled = false;
  } else {
    els.authStatus.textContent = "Signed out";
    els.signOutBtn.disabled = true;
  }
}

function updateRoleUI() {
  if (!userProfile) {
    els.adminCard.style.display = "none";
    els.judgeCard.style.display = "none";
    setRoleHint("No user profile. Create one for judge or director.");
    return;
  }

  setRoleHint(`Role: ${userProfile.role || "unknown"}`);
  els.adminCard.style.display = userProfile.role === "admin" ? "grid" : "none";
  els.judgeCard.style.display = userProfile.role === "judge" ? "grid" : "none";
}

function resetJudgeState() {
  judgePosition = null;
  formType = null;
  selectedRosterEntry = null;
  audioBlob = null;
  audioDurationSec = 0;
  captionsState = {};
  els.playback.src = "";
  els.transcriptInput.value = "";
  els.captionForm.innerHTML = "";
  els.captionTotal.textContent = "0";
  els.finalRating.textContent = "N/A";
  els.submissionHint.textContent = "Select an ensemble to begin.";
}

function calculateCaptionTotal(captions) {
  return Object.values(captions).reduce((sum, caption) => {
    const score = GRADE_VALUES[caption.gradeLetter] ?? 0;
    return sum + score;
  }, 0);
}

function computeFinalRating(total) {
  if (total >= 7 && total <= 10) return { label: "I", value: 1 };
  if (total >= 11 && total <= 17) return { label: "II", value: 2 };
  if (total >= 18 && total <= 24) return { label: "III", value: 3 };
  if (total >= 25 && total <= 31) return { label: "IV", value: 4 };
  if (total >= 32 && total <= 35) return { label: "V", value: 5 };
  return { label: "N/A", value: null };
}

function renderCaptionForm() {
  els.captionForm.innerHTML = "";
  if (!formType) return;
  const template = CAPTION_TEMPLATES[formType] || [];
  template.forEach(({ key, label }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stack";
    wrapper.dataset.key = key;

    const title = document.createElement("div");
    title.textContent = label;
    title.className = "note";

    const row = document.createElement("div");
    row.className = "row";

    const gradeSelect = document.createElement("select");
    ["A", "B", "C", "D", "F"].forEach((grade) => {
      const option = document.createElement("option");
      option.value = grade;
      option.textContent = grade;
      gradeSelect.appendChild(option);
    });

    const modifierSelect = document.createElement("select");
    ["", "+", "-"].forEach((mod) => {
      const option = document.createElement("option");
      option.value = mod;
      option.textContent = mod === "" ? "(none)" : mod;
      modifierSelect.appendChild(option);
    });

    const comment = document.createElement("textarea");
    comment.rows = 2;
    comment.placeholder = "Notes";

    const updateCaptionState = () => {
      captionsState[key] = {
        gradeLetter: gradeSelect.value,
        gradeModifier: modifierSelect.value,
        comment: comment.value.trim(),
      };
      const total = calculateCaptionTotal(captionsState);
      const rating = computeFinalRating(total);
      els.captionTotal.textContent = String(total);
      els.finalRating.textContent = rating.label;
    };

    gradeSelect.addEventListener("change", updateCaptionState);
    modifierSelect.addEventListener("change", updateCaptionState);
    comment.addEventListener("input", updateCaptionState);

    row.appendChild(gradeSelect);
    row.appendChild(modifierSelect);
    wrapper.appendChild(title);
    wrapper.appendChild(row);
    wrapper.appendChild(comment);
    els.captionForm.appendChild(wrapper);

    gradeSelect.value = "B";
    updateCaptionState();
  });
}

function renderRosterList() {
  const search = els.rosterSearch.value.trim().toLowerCase();
  const filtered = rosterEntries.filter((entry) => {
    const searchText = [entry.schoolId, entry.ensembleId, entry.stageTime]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchText.includes(search);
  });

  els.rosterList.innerHTML = "";
  filtered.forEach((entry) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><strong>${entry.stageTime}</strong> — ${entry.ensembleId}</div>
      <div class="hint">School: ${entry.schoolId} | Order ${entry.orderIndex}</div>
    `;
    const selectBtn = document.createElement("button");
    selectBtn.textContent = "Select";
    selectBtn.addEventListener("click", () => selectRosterEntry(entry));
    li.appendChild(selectBtn);
    els.rosterList.appendChild(li);
  });
}

async function selectRosterEntry(entry) {
  selectedRosterEntry = entry;
  els.submissionHint.textContent = `Selected ensemble ${entry.ensembleId}.`;
  renderCaptionForm();

  if (!activeEvent || !judgePosition || !currentUser) return;

  const submissionId = `${activeEvent.id}_${entry.ensembleId}_${judgePosition}`;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  const submissionSnap = await getDoc(submissionRef);
  if (submissionSnap.exists() && submissionSnap.data().locked) {
    els.submissionHint.textContent =
      "Submission already locked. Admin must unlock for edits.";
    els.submitBtn.disabled = true;
  } else {
    els.submitBtn.disabled = false;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!currentUser || !userProfile || userProfile.role !== "judge") return;
  if (!activeEvent || !selectedRosterEntry || !judgePosition || !formType) {
    alert("Missing active event, roster selection, or assignment.");
    return;
  }

  const submissionId = `${activeEvent.id}_${selectedRosterEntry.ensembleId}_${judgePosition}`;
  const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
  const submissionSnap = await getDoc(submissionRef);
  if (submissionSnap.exists() && submissionSnap.data().locked) {
    alert("Submission locked. Admin must unlock.");
    return;
  }

  let audioUrl = "";
  if (audioBlob) {
    const audioRef = ref(
      storage,
      `audio/${currentUser.uid}/${submissionId}/recording.webm`
    );
    await uploadBytes(audioRef, audioBlob, {
      contentType: "audio/webm",
    });
    audioUrl = await getDownloadURL(audioRef);
  }

  const captionScoreTotal = calculateCaptionTotal(captionsState);
  const rating = computeFinalRating(captionScoreTotal);

  const payload = {
    [FIELDS.submissions.status]: STATUSES.submitted,
    [FIELDS.submissions.locked]: true,
    [FIELDS.submissions.judgeUid]: currentUser.uid,
    [FIELDS.submissions.schoolId]: selectedRosterEntry.schoolId,
    [FIELDS.submissions.eventId]: activeEvent.id,
    [FIELDS.submissions.ensembleId]: selectedRosterEntry.ensembleId,
    [FIELDS.submissions.judgePosition]: judgePosition,
    [FIELDS.submissions.formType]: formType,
    [FIELDS.submissions.audioUrl]: audioUrl,
    [FIELDS.submissions.audioDurationSec]: audioDurationSec,
    [FIELDS.submissions.transcript]: els.transcriptInput.value.trim(),
    [FIELDS.submissions.captions]: captionsState,
    [FIELDS.submissions.captionScoreTotal]: captionScoreTotal,
    [FIELDS.submissions.computedFinalRatingJudge]: rating.value,
    [FIELDS.submissions.computedFinalRatingLabel]: rating.label,
    [FIELDS.submissions.updatedAt]: serverTimestamp(),
  };

  if (!submissionSnap.exists()) {
    payload[FIELDS.submissions.createdAt] = serverTimestamp();
    await setDoc(submissionRef, payload);
  } else {
    await setDoc(submissionRef, payload, { merge: true });
  }

  els.submissionHint.textContent = "Submitted and locked.";
  els.submitBtn.disabled = true;
}

function bindAuthHandlers() {
  els.emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInWithEmailAndPassword(
      auth,
      els.emailInput.value,
      els.passwordInput.value
    );
  });

  els.anonymousBtn.addEventListener("click", async () => {
    await signInAnonymously(auth);
  });

  els.signOutBtn.addEventListener("click", async () => {
    await signOut(auth);
  });

  els.createUserBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const role = els.roleSelect.value;
    const schoolId = els.schoolIdInput.value.trim();
    if (role === "director" && !schoolId) {
      alert("School ID required for director.");
      return;
    }
    const userRef = doc(db, COLLECTIONS.users, currentUser.uid);
    await setDoc(
      userRef,
      {
        role,
        schoolId: schoolId || "",
      },
      { merge: true }
    );
  });
}

function bindAdminHandlers() {
  els.createEventBtn.addEventListener("click", async () => {
    if (!els.eventNameInput.value.trim()) return;
    await addDoc(collection(db, COLLECTIONS.events), {
      name: els.eventNameInput.value.trim(),
      isActive: false,
      createdAt: serverTimestamp(),
    });
    els.eventNameInput.value = "";
  });

  els.scheduleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeEvent) {
      alert("No active event.");
      return;
    }
    await addDoc(
      collection(db, COLLECTIONS.events, activeEvent.id, COLLECTIONS.schedule),
      {
        orderIndex: Number(els.orderIndexInput.value),
        stageTime: els.stageTimeInput.value.trim(),
        schoolId: els.scheduleSchoolIdInput.value.trim(),
        ensembleId: els.scheduleEnsembleIdInput.value.trim(),
        createdAt: serverTimestamp(),
      }
    );
    els.scheduleForm.reset();
  });

  els.assignmentsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeEvent) {
      alert("No active event.");
      return;
    }
    const assignmentsRef = doc(
      db,
      COLLECTIONS.events,
      activeEvent.id,
      COLLECTIONS.assignments,
      "positions"
    );
    await setDoc(
      assignmentsRef,
      {
        stage1Uid: els.stage1UidInput.value.trim(),
        stage2Uid: els.stage2UidInput.value.trim(),
        stage3Uid: els.stage3UidInput.value.trim(),
        sightUid: els.sightUidInput.value.trim(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

function bindJudgeHandlers() {
  els.rosterSearch.addEventListener("input", renderRosterList);
  els.submissionForm.addEventListener("submit", handleSubmit);

  els.recordBtn.addEventListener("click", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      recordingChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(recordingChunks, { type: "audio/webm" });
      const url = URL.createObjectURL(audioBlob);
      els.playback.src = url;
      els.recordingStatus.textContent = "Recording ready";
    };
    mediaRecorder.start();
    els.recordBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.recordingStatus.textContent = "Recording...";
  });

  els.stopBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    els.recordBtn.disabled = false;
    els.stopBtn.disabled = true;
  });

  els.playback.addEventListener("loadedmetadata", () => {
    audioDurationSec = Number(els.playback.duration.toFixed(2));
  });

  els.draftBtn.addEventListener("click", async () => {
    if (!formType) {
      alert("No form type set yet.");
      return;
    }
    const transcript = els.transcriptInput.value.trim();
    const parseTranscript = httpsCallable(functions, "parseTranscript");
    const response = await parseTranscript({ formType, transcript });
    const drafts = response.data?.captions || {};
    Object.entries(drafts).forEach(([key, value]) => {
      const captionBlock = [...els.captionForm.children].find(
        (block) => block.dataset.key === key
      );
      if (captionBlock) {
        const textarea = captionBlock.querySelector("textarea");
        if (textarea) textarea.value = value.draft || "";
      }
      if (captionsState[key]) {
        captionsState[key].comment = value.draft || "";
      }
    });
  });
}

function watchEvents() {
  const eventsQuery = query(collection(db, COLLECTIONS.events));
  onSnapshot(eventsQuery, (snapshot) => {
    els.eventList.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <div><strong>${data.name || "Untitled"}</strong></div>
        <div class="hint">${data.isActive ? "Active" : "Inactive"}</div>
      `;
      const button = document.createElement("button");
      button.textContent = "Set Active";
      button.addEventListener("click", () => setActiveEvent(docSnap.id));
      li.appendChild(button);
      els.eventList.appendChild(li);
    });
  });
}

async function setActiveEvent(eventId) {
  const eventsSnap = await getDocs(collection(db, COLLECTIONS.events));
  const batch = writeBatch(db);
  eventsSnap.forEach((eventDoc) => {
    batch.update(eventDoc.ref, {
      isActive: eventDoc.id === eventId,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

function watchActiveEvent() {
  const activeQuery = query(
    collection(db, COLLECTIONS.events),
    where(FIELDS.events.isActive, "==", true)
  );

  onSnapshot(activeQuery, (snapshot) => {
    activeEvent = snapshot.docs[0]
      ? { id: snapshot.docs[0].id, ...snapshot.docs[0].data() }
      : null;
    if (activeEvent) {
      els.activeEventDisplay.textContent = `${activeEvent.name || "Active"} (${activeEvent.id})`;
    } else {
      els.activeEventDisplay.textContent = "No active event.";
    }
    resetJudgeState();
    watchRoster();
    watchAssignments();
  });
}

function watchRoster() {
  if (!activeEvent) {
    rosterEntries = [];
    renderRosterList();
    return;
  }
  const rosterQuery = query(
    collection(db, COLLECTIONS.events, activeEvent.id, COLLECTIONS.schedule),
    orderBy(FIELDS.schedule.orderIndex, "asc")
  );
  onSnapshot(rosterQuery, (snapshot) => {
    rosterEntries = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    renderRosterList();
    renderAdminSchedule();
  });
}

function renderAdminSchedule() {
  els.scheduleList.innerHTML = "";
  rosterEntries.forEach((entry) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><strong>${entry.stageTime}</strong> — ${entry.ensembleId}</div>
      <div class="hint">School: ${entry.schoolId} | Order ${entry.orderIndex}</div>
    `;
    els.scheduleList.appendChild(li);
  });
}

function watchAssignments() {
  if (!activeEvent) {
    assignments = null;
    judgePosition = null;
    formType = null;
    els.judgePositionDisplay.textContent = "";
    return;
  }

  const assignmentsRef = doc(
    db,
    COLLECTIONS.events,
    activeEvent.id,
    COLLECTIONS.assignments,
    "positions"
  );

  onSnapshot(assignmentsRef, (snapshot) => {
    assignments = snapshot.exists() ? snapshot.data() : null;
    if (!currentUser) return;
    judgePosition = detectJudgePosition(assignments, currentUser.uid);
    formType = judgePosition === JUDGE_POSITIONS.sight ? FORM_TYPES.sight : FORM_TYPES.stage;
    els.judgePositionDisplay.textContent = judgePosition
      ? `Assigned: ${judgePosition} (${formType})`
      : "No assignment found.";
    renderCaptionForm();
  });
}

function detectJudgePosition(assignmentsDoc, uid) {
  if (!assignmentsDoc) return null;
  if (assignmentsDoc.stage1Uid === uid) return JUDGE_POSITIONS.stage1;
  if (assignmentsDoc.stage2Uid === uid) return JUDGE_POSITIONS.stage2;
  if (assignmentsDoc.stage3Uid === uid) return JUDGE_POSITIONS.stage3;
  if (assignmentsDoc.sightUid === uid) return JUDGE_POSITIONS.sight;
  return null;
}

bindAuthHandlers();
bindAdminHandlers();
bindJudgeHandlers();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAuthUI();

  if (!user) {
    userProfile = null;
    updateRoleUI();
    resetJudgeState();
    return;
  }

  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(userRef);
  userProfile = snap.exists() ? snap.data() : null;
  updateRoleUI();
});

watchEvents();
watchActiveEvent();

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  setRoleHint("Update firebaseConfig in app.js to match your project.");
}
