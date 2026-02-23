import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "./firestore.js";
import { COLLECTIONS } from "../state.js";
import { auth, db, DEV_FLAGS } from "../firebase.js";

export async function signIn(email, password, options = {}) {
  if (options.anonymous) {
    if (!DEV_FLAGS.allowAnonymousSignIn) {
      throw new Error("Anonymous sign-in disabled");
    }
    return signInAnonymously(auth);
  }
  if (!email || !password) {
    throw new Error("Missing credentials");
  }
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signOut() {
  return firebaseSignOut(auth);
}

export async function requestPasswordReset(email) {
  if (!email) {
    throw new Error("Missing email");
  }
  return sendPasswordResetEmail(auth, email);
}

export async function createDirectorAccount({ email, password, schoolId }) {
  if (!email || !password) {
    throw new Error("Missing credentials");
  }
  if (!schoolId) {
    throw new Error("Missing school");
  }
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const verifiedEmail = credential.user?.email || email;
  const userRef = doc(db, COLLECTIONS.users, credential.user.uid);
  await setDoc(userRef, {
    role: "director",
    roles: { director: true, judge: false, admin: false },
    schoolId,
    email: verifiedEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { ok: true, credential };
}
