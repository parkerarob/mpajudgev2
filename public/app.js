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
    judgeName: "judgeName",
    judgeEmail: "judgeEmail",
    judgeTitle: "judgeTitle",
    judgeAffiliation: "judgeAffiliation",
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

const JUDGE_POSITION_LABELS = {
  stage1: "Stage 1",
  stage2: "Stage 2",
  stage3: "Stage 3",
  sight: "Sight",
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
  packetView: document.getElementById("packetView"),
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
  directorCard: document.getElementById("directorCard"),
  directorHint: document.getElementById("directorHint"),
  directorPackets: document.getElementById("directorPackets"),
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
let unsubscribeEvents = null;
let unsubscribeActiveEvent = null;
let unsubscribeRoster = null;
let unsubscribeAssignments = null;
let unsubscribeDirectorPackets = null;

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
    els.directorCard.style.display = "none";
    setRoleHint("No user profile. Create one for judge or director.");
    return;
  }

  setRoleHint(`Role: ${userProfile.role || "unknown"}`);
  els.adminCard.style.display = userProfile.role === "admin" ? "grid" : "none";
  els.judgeCard.style.display = userProfile.role === "judge" ? "grid" : "none";
  els.directorCard.style.display =
    userProfile.role === "director" ? "grid" : "none";
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

function normalizeGrade(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  if (roman.includes(text)) return text;
  const num = Number(text);
  if (!Number.isNaN(num) && num >= 1 && num <= 6) return roman[num - 1];
  return null;
}

function mapOverallLabelFromTotal(total) {
  if (total >= 4 && total <= 6) return "I";
  if (total >= 7 && total <= 10) return "II";
  if (total >= 11 && total <= 14) return "III";
  if (total >= 15 && total <= 18) return "IV";
  if (total >= 19 && total <= 20) return "V";
  return "N/A";
}

const gradeOneLookup = window.GradeOneLookup;
const GRADE_ONE_MAP = gradeOneLookup?.GRADE_ONE_MAP || {};
const computeGradeOneKey = gradeOneLookup?.computeGradeOneKey || (() => "");

function computeOverallPacketRating(grade, stageScores, sightScore) {
  const normalizedGrade = normalizeGrade(grade);
  const stageValues = stageScores.filter((value) => Number.isFinite(value));
  if (normalizedGrade === "I") {
    if (stageValues.length !== 3) return { label: "N/A", value: null };
    const key = computeGradeOneKey(stageValues);
    const label = GRADE_ONE_MAP[key] || "N/A";
    return {
      label,
      value: label === "N/A" ? null : label,
      gradeOneKey: key,
    };
  }

  if (stageValues.length !== 3 || !Number.isFinite(sightScore)) {
    return { label: "N/A", value: null };
  }

  const [s1, s2, s3] = stageValues;
  if (s1 === s2 && s2 === s3 && [3, 4, 5].includes(s1)) {
    const unanimousLabel = ["I", "II", "III", "IV", "V"][s1 - 1] || "N/A";
    return { label: unanimousLabel, value: unanimousLabel };
  }

  const total = s1 + s2 + s3 + sightScore;
  const label = mapOverallLabelFromTotal(total);
  return { label, value: label === "N/A" ? null : label };
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
    [FIELDS.submissions.judgeName]:
      userProfile?.displayName || currentUser.displayName || "",
    [FIELDS.submissions.judgeEmail]:
      userProfile?.email || currentUser.email || "",
    [FIELDS.submissions.judgeTitle]: userProfile?.title || "",
    [FIELDS.submissions.judgeAffiliation]: userProfile?.affiliation || "",
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
    const snap = await getDoc(userRef);
    userProfile = snap.exists() ? snap.data() : null;
    updateRoleUI();
    startWatchers();
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
  if (unsubscribeEvents) unsubscribeEvents();
  const eventsQuery = query(collection(db, COLLECTIONS.events));
  unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
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
  if (unsubscribeActiveEvent) unsubscribeActiveEvent();
  const activeQuery = query(
    collection(db, COLLECTIONS.events),
    where(FIELDS.events.isActive, "==", true)
  );

  unsubscribeActiveEvent = onSnapshot(activeQuery, (snapshot) => {
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
  if (unsubscribeRoster) unsubscribeRoster();
  if (!activeEvent) {
    rosterEntries = [];
    renderRosterList();
    return;
  }
  const rosterQuery = query(
    collection(db, COLLECTIONS.events, activeEvent.id, COLLECTIONS.schedule),
    orderBy(FIELDS.schedule.orderIndex, "asc")
  );
  unsubscribeRoster = onSnapshot(rosterQuery, (snapshot) => {
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
    const packetBtn = document.createElement("button");
    packetBtn.textContent = "View Packet";
    packetBtn.addEventListener("click", () => loadPacketView(entry));
    li.appendChild(packetBtn);
    els.scheduleList.appendChild(li);
  });
}

async function fetchEnsembleGrade(ensembleId) {
  const ensembleRef = doc(db, COLLECTIONS.ensembles, ensembleId);
  const ensembleSnap = await getDoc(ensembleRef);
  if (ensembleSnap.exists()) {
    return normalizeGrade(ensembleSnap.data().performanceGrade);
  }
  return null;
}

async function fetchPacketSubmissions(eventId, ensembleId) {
  const positions = [
    JUDGE_POSITIONS.stage1,
    JUDGE_POSITIONS.stage2,
    JUDGE_POSITIONS.stage3,
    JUDGE_POSITIONS.sight,
  ];
  const submissions = {};
  await Promise.all(
    positions.map(async (position) => {
      const submissionId = `${eventId}_${ensembleId}_${position}`;
      const submissionRef = doc(db, COLLECTIONS.submissions, submissionId);
      const submissionSnap = await getDoc(submissionRef);
      submissions[position] = submissionSnap.exists()
        ? { id: submissionSnap.id, ...submissionSnap.data() }
        : null;
    })
  );
  return submissions;
}

function isSubmissionComplete(submission) {
  if (!submission) return false;
  if (!submission.locked) return false;
  if (submission.status !== STATUSES.submitted) return false;
  if (!submission.audioUrl) return false;
  if (!submission.captions) return false;
  if (Object.keys(submission.captions).length < 7) return false;
  if (!Number.isFinite(submission.captionScoreTotal)) return false;
  if (!Number.isFinite(submission.computedFinalRatingJudge)) return false;
  return true;
}

function computePacketSummary(grade, submissions) {
  const normalizedGrade = normalizeGrade(grade);
  const requiredPositions =
    normalizedGrade === "I"
      ? [JUDGE_POSITIONS.stage1, JUDGE_POSITIONS.stage2, JUDGE_POSITIONS.stage3]
      : [
          JUDGE_POSITIONS.stage1,
          JUDGE_POSITIONS.stage2,
          JUDGE_POSITIONS.stage3,
          JUDGE_POSITIONS.sight,
        ];

  const requiredComplete = requiredPositions.every((position) =>
    isSubmissionComplete(submissions[position])
  );
  const requiredReleased = requiredPositions.every(
    (position) => submissions[position]?.status === STATUSES.released
  );

  const stageScores = [
    submissions.stage1?.computedFinalRatingJudge,
    submissions.stage2?.computedFinalRatingJudge,
    submissions.stage3?.computedFinalRatingJudge,
  ];
  const sightScore = submissions.sight?.computedFinalRatingJudge;
  const overall = computeOverallPacketRating(
    normalizedGrade,
    stageScores,
    sightScore
  );

  return {
    grade: normalizedGrade,
    requiredPositions,
    requiredComplete,
    requiredReleased,
    overall,
  };
}

function renderSubmissionCard(submission, position) {
  const card = document.createElement("div");
  card.className = "packet-card";
  if (!submission) {
    card.innerHTML = `
      <div class="badge">${JUDGE_POSITION_LABELS[position]}</div>
      <div class="note">No submission yet.</div>
    `;
    return card;
  }

  const header = document.createElement("div");
  header.className = "row";
  header.innerHTML = `
    <span class="badge">${JUDGE_POSITION_LABELS[position]}</span>
    <span class="note">Status: ${submission.status || "unknown"}</span>
    <span class="note">Locked: ${submission.locked ? "yes" : "no"}</span>
  `;

  const judgeInfo = document.createElement("div");
  judgeInfo.className = "note";
  const judgeName = submission.judgeName || submission.judgeUid || "Unknown";
  const judgeEmail = submission.judgeEmail || "No email";
  const judgeTitle = submission.judgeTitle || "";
  judgeInfo.textContent = `${judgeName} • ${judgeEmail}${judgeTitle ? ` • ${judgeTitle}` : ""}`;

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.className = "audio";
  if (submission.audioUrl) {
    audio.src = submission.audioUrl;
  }

  const captionSummary = document.createElement("div");
  captionSummary.className = "caption-grid";
  const captions = submission.captions || {};
  Object.entries(captions).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "caption-row";
    const gradeDisplay = `${value.gradeLetter || ""}${value.gradeModifier || ""}`;
    row.innerHTML = `
      <strong>${key}</strong>
      <div>Grade: ${gradeDisplay}</div>
      <div>${value.comment || ""}</div>
    `;
    captionSummary.appendChild(row);
  });

  const transcript = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Transcript";
  transcript.appendChild(summary);
  const transcriptBody = document.createElement("div");
  transcriptBody.className = "note";
  transcriptBody.textContent = submission.transcript || "No transcript.";
  transcript.appendChild(transcriptBody);

  const footer = document.createElement("div");
  footer.className = "note";
  footer.textContent = `Caption Total: ${submission.captionScoreTotal || 0} • Final Rating: ${submission.computedFinalRatingLabel || "N/A"}`;

  card.appendChild(header);
  card.appendChild(judgeInfo);
  card.appendChild(audio);
  card.appendChild(captionSummary);
  card.appendChild(transcript);
  card.appendChild(footer);

  return card;
}

async function loadPacketView(entry) {
  if (!activeEvent) return;
  els.packetView.innerHTML = "";
  const grade = await fetchEnsembleGrade(entry.ensembleId);
  const submissions = await fetchPacketSubmissions(
    activeEvent.id,
    entry.ensembleId
  );
  const summary = computePacketSummary(grade, submissions);

  const header = document.createElement("div");
  header.className = "packet-header";
  header.innerHTML = `
    <div><strong>Ensemble:</strong> ${entry.ensembleId}</div>
    <div class="note">School: ${entry.schoolId}</div>
    <div class="note">Grade: ${summary.grade || "Unknown"}</div>
    <div class="note">Overall: ${summary.overall.label}</div>
    <div class="note">Released: ${summary.requiredReleased ? "yes" : "no"}</div>
  `;

  if (summary.grade === "I" && summary.overall.label === "N/A") {
    const warning = document.createElement("div");
    warning.className = "empty";
    warning.textContent = `Grade I mapping missing for key ${summary.overall.gradeOneKey || "unknown"}. Release blocked.`;
    els.packetView.appendChild(warning);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const releaseBtn = document.createElement("button");
  releaseBtn.textContent = "Release Packet";
  releaseBtn.disabled =
    !summary.requiredComplete ||
    summary.requiredReleased ||
    !summary.grade ||
    (summary.grade === "I" && summary.overall.label === "N/A");
  releaseBtn.addEventListener("click", async () => {
    const releasePacket = httpsCallable(functions, "releasePacket");
    await releasePacket({
      eventId: activeEvent.id,
      ensembleId: entry.ensembleId,
    });
    await loadPacketView(entry);
  });

  const unreleaseBtn = document.createElement("button");
  unreleaseBtn.textContent = "Unrelease Packet";
  unreleaseBtn.className = "ghost";
  unreleaseBtn.disabled = !summary.requiredReleased;
  unreleaseBtn.addEventListener("click", async () => {
    const unreleasePacket = httpsCallable(functions, "unreleasePacket");
    await unreleasePacket({
      eventId: activeEvent.id,
      ensembleId: entry.ensembleId,
    });
    await loadPacketView(entry);
  });

  actions.appendChild(releaseBtn);
  actions.appendChild(unreleaseBtn);

  const grid = document.createElement("div");
  grid.className = "packet-grid";
  Object.values(JUDGE_POSITIONS).forEach((position) => {
    const submission = submissions[position];
    const card = renderSubmissionCard(submission, position);
    if (submission) {
      const lockRow = document.createElement("div");
      lockRow.className = "actions";
      const unlockBtn = document.createElement("button");
      unlockBtn.textContent = "Unlock";
      unlockBtn.className = "ghost";
      unlockBtn.disabled = submission.locked === false;
      unlockBtn.addEventListener("click", async () => {
        const unlockSubmission = httpsCallable(functions, "unlockSubmission");
        await unlockSubmission({
          eventId: activeEvent.id,
          ensembleId: entry.ensembleId,
          judgePosition: submission.judgePosition,
        });
        await loadPacketView(entry);
      });

      const lockBtn = document.createElement("button");
      lockBtn.textContent = "Lock";
      lockBtn.disabled = submission.locked === true;
      lockBtn.addEventListener("click", async () => {
        const lockSubmission = httpsCallable(functions, "lockSubmission");
        await lockSubmission({
          eventId: activeEvent.id,
          ensembleId: entry.ensembleId,
          judgePosition: submission.judgePosition,
        });
        await loadPacketView(entry);
      });

      lockRow.appendChild(unlockBtn);
      lockRow.appendChild(lockBtn);
      card.appendChild(lockRow);
    }
    grid.appendChild(card);
  });

  els.packetView.appendChild(header);
  els.packetView.appendChild(actions);
  els.packetView.appendChild(grid);
  if (!summary.requiredComplete && !summary.requiredReleased) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "Packet incomplete. Release requires all required submissions locked and submitted.";
    els.packetView.appendChild(empty);
  }
}

function renderDirectorPackets(groups) {
  els.directorPackets.innerHTML = "";
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No released packets yet.";
    els.directorPackets.appendChild(empty);
    return;
  }

  groups.forEach((group) => {
    const wrapper = document.createElement("div");
    wrapper.className = "packet";

    const header = document.createElement("div");
    header.className = "packet-header";
    header.innerHTML = `
      <div><strong>Ensemble:</strong> ${group.ensembleId}</div>
      <div class="note">Event: ${group.eventId}</div>
      <div class="note">Grade: ${group.grade || "Unknown"}</div>
      <div class="note">Overall: ${group.overall.label}</div>
    `;

    const grid = document.createElement("div");
    grid.className = "packet-grid";
    Object.values(JUDGE_POSITIONS).forEach((position) => {
      const submission = group.submissions[position];
      if (submission && submission.status === STATUSES.released) {
        grid.appendChild(renderSubmissionCard(submission, position));
      }
    });

    wrapper.appendChild(header);
    wrapper.appendChild(grid);
    els.directorPackets.appendChild(wrapper);
  });
}

function watchDirectorPackets() {
  if (unsubscribeDirectorPackets) unsubscribeDirectorPackets();
  if (!userProfile || userProfile.role !== "director") {
    els.directorHint.textContent = "";
    return;
  }
  if (!userProfile.schoolId) {
    els.directorHint.textContent =
      "Director profile missing schoolId. Update user profile or school membership.";
    return;
  }

  const submissionsQuery = query(
    collection(db, COLLECTIONS.submissions),
    where(FIELDS.submissions.schoolId, "==", userProfile.schoolId),
    where(FIELDS.submissions.status, "==", STATUSES.released)
  );

  unsubscribeDirectorPackets = onSnapshot(submissionsQuery, async (snapshot) => {
    const grouped = {};
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const key = `${data.eventId}_${data.ensembleId}`;
      if (!grouped[key]) {
        grouped[key] = {
          eventId: data.eventId,
          ensembleId: data.ensembleId,
          submissions: {},
        };
      }
      grouped[key].submissions[data.judgePosition] = {
        id: docSnap.id,
        ...data,
      };
    });

    const groups = await Promise.all(
      Object.values(grouped).map(async (group) => {
        const grade = await fetchEnsembleGrade(group.ensembleId);
        const summary = computePacketSummary(grade, group.submissions);
        return {
          ...group,
          grade,
          overall: summary.overall,
        };
      })
    );

    renderDirectorPackets(groups);
  });
}

function watchAssignments() {
  if (unsubscribeAssignments) unsubscribeAssignments();
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

  unsubscribeAssignments = onSnapshot(assignmentsRef, (snapshot) => {
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

function stopWatchers() {
  if (unsubscribeEvents) unsubscribeEvents();
  if (unsubscribeActiveEvent) unsubscribeActiveEvent();
  if (unsubscribeRoster) unsubscribeRoster();
  if (unsubscribeAssignments) unsubscribeAssignments();
  if (unsubscribeDirectorPackets) unsubscribeDirectorPackets();
  unsubscribeEvents = null;
  unsubscribeActiveEvent = null;
  unsubscribeRoster = null;
  unsubscribeAssignments = null;
  unsubscribeDirectorPackets = null;
}

function startWatchers() {
  watchEvents();
  watchActiveEvent();
  watchDirectorPackets();
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
    stopWatchers();
    return;
  }

  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(userRef);
  userProfile = snap.exists() ? snap.data() : null;
  updateRoleUI();
  startWatchers();
});

if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  setRoleHint("Update firebaseConfig in app.js to match your project.");
}
