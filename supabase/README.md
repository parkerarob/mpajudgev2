# Supabase Workspace

This directory holds the rebuild-lane database artifacts for the Next.js + Supabase system.

## Layout

- `migrations/` ordered SQL migrations
- `seeds/` deterministic seed data
- `tests/` SQL or integration checks for triggers, RLS, and packet invariants

## Conventions

- Prefer many small migrations over one monolithic schema dump.
- Keep table creation, computed logic, RLS, and RPCs in separate migrations.
- Put cross-table business rules in SQL functions and triggers, not client code.
- Release and unrelease must be implemented as transactional RPCs.
- Human-facing wording follows `docs/Domain-Language.md`; SQL identifiers follow technical naming decisions documented in `docs/Schema-Design.md` and `docs/Supabase-Migration-Plan.md`.
- When schema prose and migration reality diverge, update the docs before continuing.

## Source Documents

- `docs/Domain-Language.md`
- `docs/Schema-Design.md`
- `docs/Supabase-Migration-Plan.md`
