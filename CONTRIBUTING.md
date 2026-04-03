# Contributing

## Setup

Install dependencies:

```bash
npm install
npm --prefix functions install
```

Start Firebase emulators when working on end-to-end behavior:

```bash
firebase emulators:start
```

## Project Conventions

- Keep correctness and rule enforcement ahead of cosmetic cleanup.
- Preserve deterministic submission IDs.
- Keep release and lock transitions in Cloud Functions, not client-only code.
- Do not reintroduce removed role types like `teamLead` or `opsLead`.
- Prefer focused module extraction over adding more weight to `public/modules/ui.js`.

## Branching

Normal work should happen on a branch created from `main`.

```bash
git switch -c <branch-name>
```

Pushes to `main` deploy production, so treat that branch as release-sensitive.

## Verification Before Push

Run:

```bash
npm run test:unit
npm run test:security
npm --prefix functions run lint
```

If you change admin routing or readiness behavior, verify the related unit tests still reflect the current UI contract.

## Documentation

When behavior changes, update the matching docs:

- `README.md` for entrypoint and setup details
- `ARCHITECTURE.md` for system structure
- `USER_INSTRUCTIONS.md` for operator-facing workflow changes
- `PRD.md` for product expectations
- `docs/Domain-Language.md` for canonical terms

## Deployment Notes

- Production URL: `https://mpa-judge-v2.web.app`
- Health check: `curl -sf https://mpa-judge-v2.web.app/version.json`

Do not claim a change is shipped until the health endpoint reflects the new git SHA.
