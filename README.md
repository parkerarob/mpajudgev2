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
- Create an admin user doc in `users/{uid}` via the Firebase console or emulator UI.

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
