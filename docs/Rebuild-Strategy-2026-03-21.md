# MPAJudge Rebuild Strategy

Date: 2026-03-21

Status: Planning — requirements gathering phase

---

## Decision Record

### Context

The current MPAJudgeV2 system (Firebase/vanilla JS) successfully ran a live ~30-ensemble MPA event at Ashley High School. The system proved the product concept works but much of the admin functionality was ad-hoc firefighting during the event, not durable features. The next event is approximately one calendar year away.

### Decisions Made

1. **The current codebase is frozen.** It becomes a read-only archive for existing directors to access their released event data. No further development on the Firebase codebase.

2. **The new system will be built from scratch** on a stack designed for the long-term scale target (statewide, multi-tenant, concurrent events).

3. **Tech stack: Next.js (React) + Supabase (PostgreSQL).** React/Next.js chosen as the industry standard with the largest ecosystem, best tooling, and widest hiring/AI-agent compatibility. Supabase chosen for PostgreSQL-backed auth, storage, realtime, and row-level security without building infrastructure from scratch.

4. **Domain language must be formally defined first.** The single biggest source of confusion during development was ambiguous terminology. Terms like "grade," "score," "packet," "sheet," and "tape" had overloaded or unclear meanings. The domain glossary (`docs/Domain-Language.md`) is the foundation document for the new build.

### What the Current System Proved

- The product model works: judges record + score, admin officiates + releases, directors view results
- Queue-first submission with explicit admin approval is the right packet model
- Deterministic submission IDs prevent duplicates
- Server-side release with transactional integrity is non-negotiable
- Comments Only is a real operational mode, not a flag
- Audio segment stitching into a canonical tape is the right audio model
- Grade I and Grade I/II are no-sight paths; Grade II and above require sight
- Repair tooling is needed, but a well-designed system needs less of it
- Live event pressure reveals requirements that planning cannot

### What the Current System Did Not Prove

- That the admin workflows are correct — many were manual firefighting
- That the system can run without the developer operating it in real time
- That multi-event, multi-site, or multi-org is feasible
- That the data model scales beyond a single event's data
- That the security model is complete (70% of rules untested)

---

## Current System Archive Plan

The Firebase project (`mpa-judge-v2`) continues to run as a read-only archive:

- Directors can sign in and view their released results
- No new events, submissions, or administrative operations
- No further code deployments
- Firestore data remains accessible
- Consider adding an archive banner to the UI
- Consider exporting released packet data as backup

The archive requires no engineering investment. It stays alive until the new system is ready and historical data is migrated (if desired).

---

## New System: Target Stack

```
Frontend:      Next.js (React, TypeScript, App Router)
Database:      Supabase PostgreSQL
Auth:          Supabase Auth (email/password, MFA for admins)
Storage:       Supabase Storage (audio, PDFs, director cards)
Realtime:      Supabase Realtime (live submission feed, schedule updates)
Server Logic:  Next.js API routes + Supabase Edge Functions
AI:            OpenAI (behind job queue with spend controls)
Audio:         FFmpeg via Edge Function or background worker
PDF:           pdf-lib in API route
Monitoring:    Sentry
CI/CD:         GitHub Actions → Vercel (preview + production)
Environments:  Development + Staging (separate Supabase) + Production
```

### Why This Stack

| Requirement | How This Stack Handles It |
|------------|--------------------------|
| Relational data (events, schools, ensembles, submissions, packets) | PostgreSQL with proper foreign keys, joins, constraints |
| Multi-tenant isolation | Row-level security with org_id scoping |
| Transactional release | PostgreSQL transaction — one statement, not hand-rolled multi-doc |
| Audit trail | Database triggers, automatic, can't be bypassed |
| Real-time during events | Supabase Realtime (WebSocket on DB changes) |
| Role-based access | RLS policies + Supabase Auth roles |
| Audio storage | Supabase Storage (S3-compatible) with RLS on buckets |
| Type safety | TypeScript throughout, shared types between client and server |
| Component reuse | React component model |
| Code splitting | Next.js App Router, automatic per-route |
| AI agent compatibility | React/Next.js is the most well-understood stack by AI coding agents |
| Developer ecosystem | Largest community, most libraries, most documentation |

---

## Build Phases

### Phase 1: Foundation (Month 1-2)

**Goal:** Working skeleton with auth, routing, and database.

- Domain language glossary finalized (MUST be done first)
- PostgreSQL schema designed from domain model
- RLS policies written for all tables
- Supabase project configured (auth, storage, realtime)
- Next.js project scaffolded (TypeScript, App Router)
- Auth flow working (sign in, sign out, role detection)
- Role-based routing (admin, judge, director views)
- Shared component library started (forms, tables, modals)
- Staging environment configured

### Phase 2: Core Workflows (Month 2-5)

**Goal:** All three roles can complete their primary workflows.

Build in dependency order:

1. Org/school/ensemble management (admin)
2. Event creation and setup (admin)
3. Schedule and judge assignment (admin)
4. Director registration and entry editing (director)
5. Judge audio recording, scoring, and submission (judge)
6. Admin raw assessment review and officialization (admin)
7. Packet release (admin) — the capstone workflow
8. Director released results viewing (director)

### Phase 3: Operations and Polish (Month 5-7)

**Goal:** System is operationally complete for an event.

- PDF score sheet generation
- AI transcription and caption drafting (with spend controls)
- Admin operational dashboards (ratings, readiness, announcer)
- Error tracking (Sentry)
- E2E tests for critical workflows
- Load testing with simulated event data

### Phase 4: Staging and Validation (Month 7-9)

**Goal:** System is tested and ready for a real event.

- Full simulated event run in staging
- User acceptance testing with judges and directors
- Operational runbook written
- Historical data migration from Firebase (if desired)
- Performance validation

### Phase 5: Production and Event (Month 9-12)

**Goal:** System runs a real event.

- Production deployment
- Pre-event setup and verification
- Live event operation
- Post-event review and iteration

---

## Requirements Gathering Approach

The domain glossary and technical requirements should be built through structured Q&A about how the event actually works, not from the existing code. The code reflects what was built under pressure. The requirements should reflect what should exist.

Key question areas:

1. **Event structure** — What is an event? What is a site? How do districts and regions work?
2. **Roles and permissions** — Who does what? What should they NOT be able to do?
3. **Ensemble lifecycle** — How does an ensemble go from existing at a school to performing at an event?
4. **Judge workflow** — Step by step, what does a judge do from arrival to departure?
5. **Scoring rules** — Exactly how are captions, ratings, and overalls computed?
6. **Packet lifecycle** — What is a packet? How does it go from empty to released?
7. **Audio pipeline** — What is recorded, when, how, and what happens to it?
8. **Release rules** — What must be true before a packet can be released?
9. **Director experience** — What does a director see, when, and why?
10. **Admin operations** — What does admin actually need to do vs what was firefighting?
11. **Edge cases** — Comments Only, Grade I/II, missing audio, partial submissions
12. **Multi-event/multi-site** — How would concurrent events at different sites work?

These questions should be answered by the developer/operator (Parker) based on event experience, then documented as formal requirements before coding begins.

---

## Critical First Step: Domain Language

Before any technical design work, the domain glossary (`docs/Domain-Language.md`) must be completed and agreed upon. Every subsequent document, database schema, variable name, UI label, and agent prompt must use these terms consistently.

See `docs/Domain-Language.md` for the current draft. This document is a living reference that should be updated as requirements are gathered.
