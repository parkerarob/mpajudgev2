# Snapshot Workflow

This repo is a working snapshot of `MPAJudgeV2` for the MPAapp refactor.

Source repo:
- `/Users/parkerarob/Documents/Workspaces/Desktop-Projects/MPAJudgeV2`

Snapshot repo:
- `/Users/parkerarob/Documents/Workspaces/Desktop-Projects/MPAapp-refactor-snapshot`

Current snapshot branch:
- `refactor/snapshot-foundation`

## Rules

- Do not do refactor work in the source repo.
- Treat the source repo as protected production-adjacent state.
- Do all refactor work in this snapshot repo.
- Keep director and school data preservation as a hard constraint.
- Judge-side test data may be replaced as part of the refactor.
- Any edit inside this snapshot repo that follows the approved refactor plan is pre-authorized.
- Ask before actions outside this repo, destructive operations, deployments, or anything that would violate the protected-data boundary.

## Daily Working Pattern

1. Open and work in the snapshot repo only.
2. Branch from `refactor/snapshot-foundation` for focused work if needed.
3. Commit normally inside the snapshot repo.
4. Test and validate in the snapshot repo.
5. Do not merge back to source `main` until the refactor path is proven.

## Recommended Branch Model

- `refactor/snapshot-foundation`
  - long-lived integration branch for the snapshot refactor
- `refactor/<topic>`
  - optional short-lived branches for isolated work

Example:

```bash
cd /Users/parkerarob/Documents/Workspaces/Desktop-Projects/MPAapp-refactor-snapshot
git checkout refactor/snapshot-foundation
git checkout -b refactor/director-workspace
```

## Syncing From Source Main

If the original repo's `main` gets important fixes while refactor work is in progress:

```bash
cd /Users/parkerarob/Documents/Workspaces/Desktop-Projects/MPAapp-refactor-snapshot
git fetch origin
git checkout refactor/snapshot-foundation
git merge origin/main
```

Resolve conflicts in the snapshot repo, not in the source repo.

## Bringing The Snapshot Back To Main

When the refactor is good and validated:

1. Make sure `refactor/snapshot-foundation` is committed and pushed if needed.
2. Rebase or merge the latest `origin/main` into the snapshot branch.
3. Run the full validation/test pass in the snapshot repo.
4. Open a merge/PR flow from `refactor/snapshot-foundation` into `main`.
5. Merge only after review and final validation.

Recommended command sequence:

```bash
cd /Users/parkerarob/Documents/Workspaces/Desktop-Projects/MPAapp-refactor-snapshot
git fetch origin
git checkout refactor/snapshot-foundation
git merge origin/main
# resolve conflicts
# run tests
git push origin refactor/snapshot-foundation
```

Then merge `refactor/snapshot-foundation` into `main` through the normal review path.

## Refactor Plan

Primary plan document:
- `docs/MPAapp Refactor Plan With Data Preservation Boundary.md`

That plan is the source of truth for:
- protected director/school/event-entry data
- simplified judge capture responsibilities
- admin-controlled officialization
