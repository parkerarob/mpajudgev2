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

    await setDoc(doc(db, "schools/school-1"), {
      name: "School One",
    });
    await setDoc(doc(db, "schools/school-2"), {
      name: "School Two",
    });
    await setDoc(doc(db, "schools/school-1/ensembles/ensemble-1"), {
      name: "Symphonic Band",
      schoolId: "school-1",
    });
    await setDoc(doc(db, "schools/school-2/ensembles/ensemble-2"), {
      name: "Wind Ensemble",
      schoolId: "school-2",
    });

    await setDoc(doc(db, "users/director-1"), {
      role: "director",
      schoolId: "school-1",
      email: "director@example.com",
      roles: {director: true},
    });
    await setDoc(doc(db, "users/judge-1"), {
      role: "judge",
      schoolId: "school-1",
      email: "judge@example.com",
      roles: {judge: true},
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

describe("director school attachment", () => {
  it("allows a director to change or clear their own school attachment", async () => {
    const ctx = testEnv.authenticatedContext("director-1", {
      email: "director@example.com",
    });
    const db = ctx.firestore();

    await assertSucceeds(updateDoc(doc(db, "users/director-1"), {
      schoolId: "school-2",
    }));

    await assertSucceeds(updateDoc(doc(db, "users/director-1"), {
      schoolId: null,
    }));
  });

  it("allows a reattached director to manage ensembles and event forms for the new school", async () => {
    const ctx = testEnv.authenticatedContext("director-1", {
      email: "director@example.com",
    });
    const db = ctx.firestore();

    await assertSucceeds(updateDoc(doc(db, "users/director-1"), {
      schoolId: "school-2",
    }));

    await assertSucceeds(setDoc(doc(db, "events/event-open/entries/ensemble-2"), {
      eventId: "event-open",
      schoolId: "school-2",
      ensembleId: "ensemble-2",
      lunchOrder: {
        pepperoniQty: 0,
        cheeseQty: 0,
        pickupTiming: "",
        notes: "",
      },
      registrationNote: "Director can manage forms after reattachment.",
    }, {merge: true}));
  });

  it("blocks a director from writing an entry for an ensemble outside their school", async () => {
    const ctx = testEnv.authenticatedContext("director-1", {
      email: "director@example.com",
    });
    const db = ctx.firestore();

    await assertFails(setDoc(doc(db, "events/event-open/entries/ensemble-2"), {
      eventId: "event-open",
      schoolId: "school-1",
      ensembleId: "ensemble-2",
      lunchOrder: {
        pepperoniQty: 0,
        cheeseQty: 0,
        pickupTiming: "",
        notes: "",
      },
    }, {merge: true}));
  });
});
