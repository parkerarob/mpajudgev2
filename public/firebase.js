import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getFunctions,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  getStorage,
  connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyCmU330VAfE3CBPVAzVn5hwfSOfaPPcR0w",
  authDomain: "mpa-judge-v2.firebaseapp.com",
  projectId: "mpa-judge-v2",
  storageBucket: "mpa-judge-v2.firebasestorage.app",
  messagingSenderId: "980029437534",
  appId: "1:980029437534:web:8db263a70d202cbde926cf",
  measurementId: "G-Y8RQJEWTVL"
};

const APP_CHECK_SITE_KEY = "6LfYOHQsAAAAAGXP0HnxPl4muUCMWsUVfNOZ9q8B";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export const useEmulators =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
export const DEV_FLAGS = {
  allowAnonymousSignIn: useEmulators,
};

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

if (useEmulators) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

if (useEmulators) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider("debug"),
    isTokenAutoRefreshEnabled: true,
  });
}

export { firebaseConfig };
