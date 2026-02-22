# MPA Judge (Phase 1)

## Local development (emulators)

```bash
firebase emulators:start
```

If functions dependencies are not installed:

```bash
npm --prefix functions install
```

Frontend config:
- Update `public/app.js` with your Firebase web config.
- Create an admin user doc in `users/{uid}` via the Firebase console or emulator UI (see Bootstrap below).

User provisioning (admin-only):
- Use the Admin console "Provision User" panel to create judge/director accounts.
- The tool creates the Auth user (email/password) and writes `users/{uid}` with `role` and optional `schoolId`.
- If you leave the temporary password blank, the UI will show a generated password to share securely.
- Directors can be provisioned without a school and later attach from their dashboard.

Schools directory (seeded by admin):
- Use the Admin console "Schools Directory" panel to add schools.
- For bulk import, paste lines in `schoolId,School Name` format and click Import.
- Directors select from this seeded list during signup or attach.
- Schools are readable without auth to allow public director signup.
- Seed schools before attempting director signup.

Director signup + attach/detach:
- Directors can create accounts from the Sign In modal (email/password + school).
- If a director has no school attached, the Director dashboard blocks access until a school is selected.
- Directors can detach from their school and later attach to another school.

Bootstrap the first admin (safe/manual):
1. Create an Auth user in Firebase Auth (email/password).
2. Copy the UID.
3. Create `users/{uid}` in Firestore with:
   - `role: "admin"`
   - `schoolId: ""` (optional)

DEV-only features:
- Anonymous sign-in is available only when running on emulators (`localhost`).
- To disable anonymous sign-in everywhere, set `DEV_FLAGS.allowAnonymousSignIn` to `false` in `public/app.js`.

OpenAI transcription (Cloud Functions):
- Store the OpenAI key as a Firebase Functions secret named `OPENAI_API_KEY`.
- Example (Firebase CLI): `firebase functions:secrets:set OPENAI_API_KEY`
- Deploy will prompt to configure the secret if missing.

Emulator seed (optional):
```bash
firebase emulators:start
```
```bash
npm --prefix functions run seed:emulator
```

Grade I lookup test:
```bash
node functions/scripts/test-grade1-lookup.js
```

## Deploy

```bash
firebase deploy
```

```bash
firebase deploy --only hosting,functions,firestore,storage
```
