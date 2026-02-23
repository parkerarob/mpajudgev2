import { doc, serverTimestamp, setDoc } from "./firestore.js";
import { db } from "../firebase.js";
import { COLLECTIONS, state } from "../state.js";

export async function saveUserDisplayName(name) {
  if (!state.auth.currentUser || !state.auth.userProfile) {
    return { ok: false, reason: "not-authorized" };
  }
  const userRef = doc(db, COLLECTIONS.users, state.auth.currentUser.uid);
  await setDoc(
    userRef,
    {
      displayName: name,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  state.auth.userProfile.displayName = name;
  return { ok: true };
}
