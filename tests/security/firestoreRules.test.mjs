import fs from "node:fs";
import path from "node:path";
import {afterAll, beforeAll, describe, it} from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {doc, setDoc, updateDoc} from "firebase/firestore";

const PROJECT_ID = "mpa-judge-v2";

let testEnv;

async function seedFirestoreDocs() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "users/director-1"), {
      role: "director",
      schoolId: "school-1",
      roles: {director: true},
    });

    await setDoc(doc(db, "events/event-open"), {
      isActive: true,
      pizzaOrdersClosed: false,
    });
    await setDoc(doc(db, "events/event-closed"), {
      isActive: false,
      pizzaOrdersClosed: true,
    });

    await setDoc(doc(db, "events/event-closed/entries/ensemble-1"), {
      eventId: "event-closed",
      schoolId: "school-1",
      ensembleId: "ensemble-1",
      lunchOrder: {
        pepperoniQty: 2,
        cheeseQty: 1,
        pickupTiming: "before",
        notes: "",
      },
      registrationNote: "",
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  await seedFirestoreDocs();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("firestore pizza order lock", () => {
  it("allows a director to write lunch orders while the event window is open", async () => {
    const ctx = testEnv.authenticatedContext("director-1");
    const db = ctx.firestore();

    await assertSucceeds(setDoc(doc(db, "events/event-open/entries/ensemble-1"), {
      eventId: "event-open",
      schoolId: "school-1",
      ensembleId: "ensemble-1",
      lunchOrder: {
        pepperoniQty: 3,
        cheeseQty: 0,
        pickupTiming: "after",
        notes: "",
      },
    }, {merge: true}));
  });

  it("blocks a director from changing lunch orders after the window closes", async () => {
    const ctx = testEnv.authenticatedContext("director-1");
    const db = ctx.firestore();

    await assertFails(updateDoc(doc(db, "events/event-closed/entries/ensemble-1"), {
      lunchOrder: {
        pepperoniQty: 4,
        cheeseQty: 1,
        pickupTiming: "after",
        notes: "",
      },
    }));
  });

  it("still allows a director to update non-lunch fields after the window closes", async () => {
    const ctx = testEnv.authenticatedContext("director-1");
    const db = ctx.firestore();

    await assertSucceeds(updateDoc(doc(db, "events/event-closed/entries/ensemble-1"), {
      registrationNote: "Need early unload access.",
    }));
  });
});
