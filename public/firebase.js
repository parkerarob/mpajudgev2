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
  apiKey: "AIzaSyAPljc51n29A7a4RmTT1dWIzY1mOlr6bTE",
  authDomain: "mpaapp-1.firebaseapp.com",
  projectId: "mpaapp-1",
  storageBucket: "mpaapp-1.firebasestorage.app",
  messagingSenderId: "613127595018",
  appId: "1:613127595018:web:5eb02aa37b99ec930f2bf3",
  measurementId: "G-M0KEN6YS56"
};

const APP_CHECK_SITE_KEY = "6LfYOHQsAAAAAGXP0HnxPl4muUCMWsUVfNOZ9q8B";
const APP_CHECK_FLAG_KEY = "mpa.enableAppCheck";
const APP_CHECK_ROLLOUT_MODE = "deferred"; // "deferred" | "enforced"

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

const appCheckFlag = (() => {
  try {
    return window.localStorage?.getItem(APP_CHECK_FLAG_KEY) || "";
  } catch {
    return "";
  }
})();

const manualAppCheckOverride = appCheckFlag === "1";
const shouldEnableAppCheck =
  !useEmulators && (APP_CHECK_ROLLOUT_MODE === "enforced" || manualAppCheckOverride);

if (shouldEnableAppCheck) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} else {
  console.warn(
    useEmulators
      ? "[firebase] App Check disabled for localhost emulator testing."
      : `[firebase] App Check deferred. Set localStorage.${APP_CHECK_FLAG_KEY} = "1" for manual testing.`
  );
}

export { firebaseConfig };
